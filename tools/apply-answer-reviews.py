"""Integrate explicit, individually reviewed reference answers into the bank."""
from pathlib import Path
from datetime import datetime,timezone
import json
from collections import Counter
import argparse

root=Path(__file__).resolve().parents[1]
folder=root/'tools/answer-reviews'
bank_path=root/'dist/data/questions.json'
baseline=folder/'bank-before-review.json'
folder.mkdir(exist_ok=True)
parser=argparse.ArgumentParser()
parser.add_argument('--refresh-baseline',action='store_true')
args=parser.parse_args()
if not baseline.exists() or args.refresh_baseline:
    baseline.write_bytes(bank_path.read_bytes())
bank=json.loads(baseline.read_text(encoding='utf-8'))
reviews={}
for path in sorted(folder.glob('part-*.json')):
    data=json.loads(path.read_text(encoding='utf-8-sig'))
    if isinstance(data,dict):
        data=data.get('questions',data.get('reviews',data))
        if isinstance(data,dict):data=[dict(v,id=k) for k,v in data.items()]
    for item in data:
        assert item['id'] not in reviews,('duplicate review',item['id'])
        reviews[item['id']]=item
questions=bank['questions']
missing=[q['id'] for q in questions if q['id'] not in reviews]
if missing:raise RuntimeError(f'Missing {len(missing)} reviews: {missing[:12]}')
changes=[]
for q in questions:
    previous=q['answer']
    patch=reviews[q['id']]
    assert isinstance(patch.get('explanation'),str) and len(patch['explanation'].strip())>=8,q['id']
    q.update({k:v for k,v in patch.items() if k not in {'id','number','chapter','topic','source','images'}})
    q['answerSource']='reviewed'
    if q['answer'] is None:
        q['questionType']='invalid'
        assert q.get('referenceAnswer'),q['id']
    else:
        assert isinstance(q['answer'],list) and q['answer'],q['id']
        if not q.get('questionType'):q['questionType']='multiple' if len(q['answer'])>1 else 'single'
        assert q['questionType'] in {'single','multiple','ordered'},q['id']
        if not q['options'] and q['mode']=='scan':q['options']=['A','B','C','D']
        assert len(q['options'])>=2,q['id']
        assert all(isinstance(x,int) and 0<=x<len(q['options']) for x in q['answer']),q['id']
    if q['mode']=='scan':assert q['images'],q['id']
    assert all((root/'dist'/p).is_file() for p in q['images']),q['id']
    q['reviewNote']=patch.get('reviewNote',patch.get('note',''))
    q['note']=q['reviewNote']
    q['searchText']=' '.join([q['stem'],*q['options'],q['topic']])
    if previous!=q['answer']:changes.append({'id':q['id'],'number':q['number'],'previous':previous,'reference':q['answer'],'explanation':q['explanation']})
bank['version']='2.0.0'
bank['generatedAt']=datetime.now(timezone.utc).isoformat(timespec='seconds')
bank['answerPolicy']='全部题目均提供逐题整理的参考结论与简短解析。正常题目依据参考答案判分；原题无唯一答案、选项错误或条件不足的题目明确说明原因，不计入正误统计。原图作答痕迹不作为正确答案依据。'
assert len(questions)==len(reviews)==533
assert len({q['id'] for q in questions})==533
bank_path.write_text(json.dumps(bank,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
report={'total':533,'reviewed':len(reviews),'autoGraded':sum(bool(q['answer']) for q in questions),'questionTypes':dict(Counter(q['questionType'] for q in questions)), 'modes':dict(Counter(q['mode'] for q in questions)), 'changes':changes}
(folder/'review-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='changes'},ensure_ascii=False))
