cd ../source/cdk
yarn install --silent
yarn test

cd ../custom-resource
yarn install --silent
yarn test

cd ../job-submit
yarn install --silent
yarn test
