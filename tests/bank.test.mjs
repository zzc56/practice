import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

test('533 道题都有参考结论和解析，正常题可判分，原题问题明确标出', async () => {
  const bank = JSON.parse(await readFile(path.join(dist, 'data/questions.json'), 'utf8'));
  assert.equal(bank.total, 533);
  assert.equal(bank.questions.length, 533);
  assert.equal(bank.chapters.length, 8);
  assert.equal(new Set(bank.questions.map(question => question.id)).size, 533);
  assert.deepEqual(bank.questions.map(question => question.number).sort((a, b) => a - b), Array.from({ length: 533 }, (_, i) => i + 1));
  const chapters = new Set(bank.chapters.map(chapter => chapter.id));
  for (const chapter of bank.chapters) {
    assert.equal(chapter.count, bank.questions.filter(question => question.chapter === chapter.id).length);
  }
  let auto = 0;
  for (const question of bank.questions) {
    assert.ok(chapters.has(question.chapter));
    assert.ok(['text', 'scan'].includes(question.mode));
    assert.equal(typeof question.stem, 'string');
    assert.ok(question.stem.trim());
    if (question.mode === 'scan') {
      assert.ok(question.images.length > 0, `${question.id} 的原图缺失`);
    }
    assert.equal(question.answerSource,'reviewed');
    assert.ok(typeof question.explanation==='string'&&question.explanation.trim().length>=8,`${question.id} 缺少具体解析`);
    assert.ok(['single','multiple','ordered','invalid'].includes(question.questionType),question.id);
    if(question.questionType==='invalid'){
      assert.equal(question.answer,null);
      assert.ok(typeof question.referenceAnswer==='string'&&question.referenceAnswer.trim(),`${question.id} 缺少参考结论`);
    }else{
      assert.ok(question.answer?.length,`${question.id} 缺少参考答案`);
      assert.ok(question.options.length>=2,`${question.id} 缺少可选选项`);
    }
    if (question.answer?.length) {
      auto++;
      assert.equal(question.answerSource, 'reviewed');
      for (const index of question.answer) assert.ok(Number.isInteger(index) && index >= 0 && index < question.options.length);
    }
    for (const image of question.images) {
      assert.match(image, /^assets\/questions\/[a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp)$/);
      assert.ok((await stat(path.join(dist, image))).size > 0);
    }
  }
  assert.ok(auto > 450, '绝大多数题目应能够自动判分');
});
