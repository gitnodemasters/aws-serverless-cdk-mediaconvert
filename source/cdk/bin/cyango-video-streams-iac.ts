#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { CyangoVideoStreamsIac } from '../lib/cyango-video-streams-iac-stack';

const app = new cdk.App();

new CyangoVideoStreamsIac(app, 'CyangoVideoStreamsDevStack', {
  stage: 'dev'
});

new CyangoVideoStreamsIac(app, 'CyangoVideoStreamsProdStack', {
  stage: 'prod'
});