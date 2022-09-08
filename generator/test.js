import * as generator from './generate.js';
import p5 from 'node-p5';
import seedrandom from 'seedrandom';
import fs from 'fs';
import util from 'node:util';
import { exec } from 'node:child_process';
const asyncExec = util.promisify(exec);


function getRandomSeed() {
  // Use either for testing...
  let randomSeed = Math.random() + ""
  let constantSeed = "ADSFSEED"
  return constantSeed;
}

function getRandomGenerator() {
  return seedrandom(getRandomSeed());
}

function getAssetList() {
  var assetPath = 'assets/'; // 'assets/'
  var files = fs.readdirSync(assetPath);
  const assetFolders = files.filter(f => fs.lstatSync(assetPath + f).isDirectory() && !f.startsWith('.'));
  const assets = {}
  for (let af of assetFolders) {
    console.log("Indexing Asset Folder: " + af)
    const files = fs.readdirSync(assetPath + af).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
    assets[af] = files
  }

  return assets;
}

async function main() {
  console.log("Setting up sketch: ");

  // Example
  const txn_hash = "ooY6b3EDUB6zprbAiSByj3MFbgkLvSlVz8GSxLC4a1Szwzf12Mw";

  const seed = getRandomSeed();
  generator.init(seedrandom(seed), txn_hash);
  const assets = getAssetList();
  const generatorConfig = generator.getGeneratorConfig(assets);
  console.dir(generatorConfig);

  const threads = [];
  if (!generatorConfig.frames) generatorConfig.frames = 1;

  for (let frameNum = 0; frameNum < generatorConfig.frames; frameNum++) {
    if (generatorConfig.parallel) {
      console.log("Spawning worker for frame: "+frameNum);
      const promise = asyncExec(`node test.js ${txn_hash} ${frameNum} ${seed}`);
      threads.push(promise);
    } else {
      await worker(txn_hash, assets, frameNum, seed);
    }
  }

  if (threads.length) {
    console.log("awaiting all threads...");
    await Promise.all(threads);
    console.log("workers done!");
  }

  const features = generator.getFeatures();
  const attributes = [];
  for (let feature in features) {
    let value = features[feature];
    attributes.push({ name: feature, value: value });
  }
  fs.writeFileSync('out-'+seed+'.json', JSON.stringify(attributes));

  if (generatorConfig.type == 'gif') {
    // Combine...
    const framerate = generatorConfig.frameRate ? parseInt(generatorConfig.frameRate) : 10;
    await asyncExec('ffmpeg -f image2 -framerate '+framerate+' -i frame-%d.png -y out.gif');
    await asyncExec('gifsicle --batch --optimize out-'+seed+'.gif');
    for (let frameNum = 0; frameNum < generatorConfig.frames; frameNum++) {
      fs.unlinkSync('frame-'+frameNum+'.png');
    }
  } else {
    fs.renameSync('frame-0.png', 'out-'+seed+'.png');
  }
}



async function singleFrame(txn_hash, assets, frameNum, seed) {
  const random = seedrandom(seed);

  generator.init(random, txn_hash);
  const config = generator.getGeneratorConfig(assets);
  console.dir(config);

  const promise = new Promise(async (resolve, reject) => {
    let p5instance = await p5.createSketch(async (sketch) => {
      console.log("sketch created");
      sketch.setup = async () => {
        try {
          generator.init(random, txn_hash);

          const params = {
            frame: frameNum,
            ...config.params,
          }

          console.log("Calling draw()..");
          const draw_start = Date.now();
          resolve(await generator.draw(sketch, assets, params));
          console.log("draw() finished ("+(Date.now()-draw_start)+")");

        } catch (e) {
          console.log("Error running setup: ", e);
          reject();
        }
        sketch.noLoop();
      }
    });
  });

  return promise;
}

async function worker(txn_hash, assets, frameNum, seed) {
  const dataURL = await singleFrame(txn_hash, assets, frameNum, seed);
  const base64 = dataURL.replace(/^data:image\/png;base64,/, "");
  const buffer = Buffer.from(base64, 'base64');
  const filename = 'frame-'+frameNum+'.png';
  fs.writeFileSync(filename, buffer);
}

if (process.argv.length == 2) {
  // Main thread, spawns workers...
  main();
} else {
  // Worker thread...
  if (process.argv.length < 5) {
    console.dir(process.argv);
    throw new Exception("incorrect number of args");
  } else {
    const txn_hash = process.argv[2];
    const frameNum = parseInt(process.argv[3]);
    const seed = process.argv[4];
    const assets = getAssetList();
    worker(txn_hash, assets, frameNum, seed);
  }
}
