import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import * as CyangoVideoStack from '../lib/cyango-video-streams-iac-stack';

test('VOD Foundation Stack Test', () => {
  const stack = new Stack();
  new CyangoVideoStack.CyangoVideoStreamsIac(stack, 'CyangoVideoStreamsIacStack');
  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});