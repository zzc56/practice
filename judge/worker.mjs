import {parentPort,workerData} from 'node:worker_threads';

try {
  const {wasm,input,expected}=workerData;
  const bytes=Buffer.from(input);
  let index=0;
  const output=[];
  const {instance}=await WebAssembly.instantiate(wasm,{env:{
    judge_read:()=>index<bytes.length ? bytes[index++] : -1,
    judge_write:byte=>{
      if(output.length>=8192)throw new Error('Output limit');
      output.push(byte);
    }
  }});
  instance.exports.run();
  const normalize=value=>value.replace(/\r\n/g,'\n').split('\n').map(line=>line.trimEnd()).join('\n').trim();
  parentPort.postMessage(normalize(Buffer.from(output).toString('utf8'))===normalize(expected));
} catch {
  parentPort.postMessage(false);
}
