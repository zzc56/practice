import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAnswer,referenceLabel,createState,recordAnswer,normalizeState} from '../dist/core.js';

test('单选与多选按参考答案判分，多选不依赖选择顺序',()=>{
  assert.equal(evaluateAnswer({answer:[2]},[2]),true);
  assert.equal(evaluateAnswer({answer:[2]},[1]),false);
  assert.equal(evaluateAnswer({answer:[0,2,3],questionType:'multiple'},[3,0,2]),true);
  assert.equal(evaluateAnswer({answer:[0,2,3],questionType:'multiple'},[0,2]),false);
});
test('顺序填空保留空位顺序和重复选择',()=>{
  const q={answer:[2,3],questionType:'ordered'};
  assert.equal(evaluateAnswer(q,[2,3]),true);
  assert.equal(evaluateAnswer(q,[3,2]),false);
  const state=recordAnswer(createState(),'q',false,{answer:[3,2]});
  assert.deepEqual(normalizeState(state,['q']).records.q.lastAnswer,[3,2]);
  assert.equal(evaluateAnswer({answer:[2,2],questionType:'ordered'},[2,2]),true);
  assert.match(referenceLabel(q),/第 1 空：C；第 2 空：D/);
});
test('原题无唯一答案时给出明确参考结论，不强行判分',()=>{
  const q={answer:null,questionType:'invalid',referenceAnswer:'选项中没有正确答案'};
  assert.equal(evaluateAnswer(q,[0]),null);
  assert.equal(referenceLabel(q),'选项中没有正确答案');
});
