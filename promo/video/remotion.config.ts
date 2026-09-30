// Remotion CLI / Studio settings. Only applies to the CLI (`npm run dev`); scripts/render.mjs and
// scripts/check.mjs call the renderer API directly and set their own options.
// https://www.remotion.dev/docs/config
import {Config} from '@remotion/cli/config';

Config.setEntryPoint('src/index.ts');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// BT.709 so the mp4's colours match what the Studio shows (the default tags BT.601).
Config.setColorSpace('bt709');
