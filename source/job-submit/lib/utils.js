/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
const AWS = require("aws-sdk");
const childProcessPromise = require("./child-process-promise");

const getFileMeta = async (bucket, key) => {
  console.log(`Getting file meta: ${key}, from s3: ${bucket}`);

  try {
    const s3 = new AWS.S3();
    const s3Object = await s3
      .headObject({
        Bucket: bucket,
        Key: key,
      })
      .promise();

    const meta = s3Object.Metadata || {};
    console.log(`file meta: ${JSON.stringify(meta)}`);
    return meta;
  } catch (err) {
    throw {
      Message: "Failed to get file meta",
      Error: err.toString(),
    };
  }
};

/**
 * Download Job Settings from s3 and run a basic validationvalidate
 */
const getJobSettings = async (bucket, settingsFile) => {
  console.log(
    `Downloading Job Settings file: ${settingsFile}, from S3: ${bucket}`
  );
  let settings;
  try {
    /**
     * Download the dsettings file for S3
     */
    const s3 = new AWS.S3();
    settings = await s3
      .getObject({
        Bucket: bucket,
        Key: settingsFile,
      })
      .promise();
    settings = JSON.parse(settings.Body);
    /**
     * Basic file validation for the settings file
     *
     */
    if (
      !("Settings" in settings) ||
      ("Inputs" in settings && settings.Inputs.length > 1)
    ) {
      throw new Error("Invalid settings file in s3");
    }
  } catch (err) {
    throw {
      Message:
        "Failed to download and validate the job-settings.json file. Please check its contents and location. Details  on using custom settings: https://github.com/awslabs/video-on-demand-on-aws-foundations",
      Error: err.toString(),
    };
  }
  return settings;
};

/**
 * Parse the job settings file and update the inputs/outputs. the num values are
 * to dupport multiple output groups of the same type.
 *
 */
const updateJobSettings = async (
  job,
  inputPath,
  outputPath,
  metadata,
  role,
  ratio = 0
) => {
  console.log(`Updating Job Settings with the source and destination details`);
  const getPath = (group, num) => {
    try {
      let path = "";
      if (group.CustomName) {
        path = `${outputPath}/${group.CustomName.replace(/\s+/g, "")}/`;
      } else {
        path = `${outputPath}/${group.Name.replace(/\s+/g, "")}${num}/`;
      }
      return path;
    } catch (err) {
      throw Error(
        "Cannot validate group name in job.Settings.OutputGroups. Please check your job settings file."
      );
    }
  };
  try {
    let fileNum = 1;
    let hlsNum = 1;
    let dashNum = 1;
    let mssNum = 1;
    let cmafNum = 1;
    job.Settings.Inputs[0].FileInput = inputPath;
    const outputGroups = job.Settings.OutputGroups;
    for (let group of outputGroups) {
      switch (group.OutputGroupSettings.Type) {
        case "FILE_GROUP_SETTINGS":
          group.OutputGroupSettings.FileGroupSettings.Destination = getPath(
            group,
            fileNum++
          );
          break;
        case "HLS_GROUP_SETTINGS":
          group.OutputGroupSettings.HlsGroupSettings.Destination = getPath(
            group,
            hlsNum++
          );

          if (ratio && group.Outputs) {
            group.Outputs.forEach((item) => {
              if (item.VideoDescription && item.VideoDescription.Width) {
                item.VideoDescription.Height = Math.round(
                  item.VideoDescription.Width / ratio
                );
              }
            });
          }

          break;
        case "DASH_ISO_GROUP_SETTINGS":
          group.OutputGroupSettings.DashIsoGroupSettings.Destination = getPath(
            group,
            dashNum++
          );
          break;
        case "MS_SMOOTH_GROUP_SETTINGS":
          group.OutputGroupSettings.MsSmoothGroupSettings.Destination = getPath(
            group,
            mssNum++
          );
          break;
        case "CMAF_GROUP_SETTINGS":
          group.OutputGroupSettings.CmafGroupSettings.Destination = getPath(
            group,
            cmafNum++
          );
          break;
        default:
          throw Error(
            "OutputGroupSettings.Type is not a valid type. Please check your job settings file."
          );
      }
    }
    /**
     * Default setting of preferred will enable acceleration if the source file is supported.
     */
    if (!("AccelerationSettings" in job)) {
      job.AccelerationSettings = "PREFERRED";
    }
    job.Role = role;
    /**
     * if Queue is included, make sure it's just the queue name and not the ARN
     */
    if (job.Queue && job.Queue.split("/").length > 1) {
      job.Queue = job.Queue.split("/")[1];
    }
    /**
     * merge user defined metadata with the solution metadata. this is used to track
     * jobs submitted to MediaConvert by the solution
     */
    job.UserMetadata = { ...job.UserMetadata, ...metadata };
  } catch (err) {
    throw {
      Message:
        "Failed to update the job-settings.json file. Details on using custom settings: https://github.com/awslabs/video-on-demand-on-aws-foundations",
      Error: err.toString(),
    };
  }
  return job;
};

/**
 * Create and encoding job in MediaConvert
 */
const createJob = async (job, endpoint) => {
  const mediaconvert = new AWS.MediaConvert({
    endpoint: endpoint,
  });
  try {
    await mediaconvert.createJob(job).promise();
    console.log(
      `job subbmited to MediaConvert:: ${JSON.stringify(job, null, 2)}`
    );
  } catch (err) {
    throw err;
  }
  return;
};

/**
 * Send An sns notification for any failed jobs
 */
const sendError = async (topic, stackName, logGroupName, err) => {
  console.log(`Sending SNS error notification: ${err}`);
  const sns = new AWS.SNS({
    region: process.env.REGION,
  });
  try {
    const msg = {
      Details: `https://console.aws.amazon.com/cloudwatch/home?region=${process.env.AWS_REGION}#logStream:group=${logGroupName}`,
      Error: err,
    };
    await sns
      .publish({
        TargetArn: topic,
        Message: JSON.stringify(msg, null, 2),
        Subject: `${stackName}: Encoding Job Submit Failed`,
      })
      .promise();
  } catch (err) {
    throw err;
  }
  return;
};

/**
 * Calculate video ratio
 */
const calculateVideoRatio = async (bucket, videoFile) => {
  console.log(`Calculating Video Ratio: ${videoFile}, from S3: ${bucket}`);
  try {
    const s3 = new AWS.S3();
    const videoUrl = await s3.getSignedUrl("getObject", {
      Bucket: bucket,
      Key: videoFile,
      Expires: 600,
    });
    console.log("video url", videoUrl);

    const metadata = await childProcessPromise.spawn("/opt/bin/ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      videoUrl,
    ]);
    console.log("video metadata", metadata);

    const stream = JSON.parse(metadata).streams[0];

    return stream.width / stream.height;
  } catch (err) {
    console.log("---err", err.toString());
    throw {
      Message: "Failed to calculate video ratio",
      Error: err.toString(),
    };
  }
};

module.exports = {
  getFileMeta: getFileMeta,
  getJobSettings: getJobSettings,
  updateJobSettings: updateJobSettings,
  createJob: createJob,
  sendError: sendError,
  calculateVideoRatio: calculateVideoRatio,
};
