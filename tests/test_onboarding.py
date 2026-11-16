import unittest,sys,json,copy,tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from onboarding import Wizard, steps, active, load, save, leaves

class OnboardingTests(unittest.TestCase):
 def setUp(self):
  """为每个测试建立独立临时配置，避免更改真实用户状态。"""
  base=ROOT/'.local/tests';base.mkdir(parents=True,exist_ok=True)
  self.temp=tempfile.TemporaryDirectory(dir=base);self.root=Path(self.temp.name)
  self.config=load(ROOT/'config.json');self.workflow=load(ROOT/'workflow/文案编写配置.json')
  for key in ['font','bodyFont']:self.config['brand'][key]['file']=str(ROOT/self.config['brand'][key]['file'])
  save(self.root/'config.json',self.config);save(self.root/'workflow/文案编写配置.json',self.workflow)
  self.w=Wizard(self.root)
 def tearDown(self):
     """清理该用例创建的临时目录。"""
     self.temp.cleanup()
 def test_new_user_starts_at_brand_and_waits(self):
  """回归验证new user starts at brand and waits；隔离输入并断言实际成功或拒绝行为。"""
  before=(self.root/'config.json').read_bytes()
  a=self.w.next();b=self.w.next()
  self.assertEqual(a['next']['id'],'config:brand.name');self.assertEqual(a,b)
  self.assertEqual(before,(self.root/'config.json').read_bytes())
 def test_only_current_item_can_be_answered(self):
  """回归验证only current item can be answered；隔离输入并断言实际成功或拒绝行为。"""
  with self.assertRaisesRegex(ValueError,'currently pending'):
   self.w.answer('config:tts.speed',1.1)
 def test_resume_persists_brand_and_does_not_touch_live_config(self):
  """回归验证resume persists brand and does not touch live config；隔离输入并断言实际成功或拒绝行为。"""
  self.w.answer('config:brand.name','我的新账号')
  resumed=Wizard(self.root)
  self.assertEqual(resumed.next()['next']['id'],'config:writing.videoStyle')
  self.assertEqual(resumed.read()['config']['brand']['name'],'我的新账号')
  self.assertEqual(load(self.root/'config.json')['brand']['name'],'RayTalk')
 def test_invalid_value_does_not_advance(self):
  """回归验证invalid value does not advance；隔离输入并断言实际成功或拒绝行为。"""
  self.w.answer('config:brand.name','账号')
  before=self.w.next()
  with self.assertRaisesRegex(ValueError,'Expected text'):self.w.answer(before['next']['id'],13)
  self.assertEqual(before,self.w.next())
 def test_explicit_keep_all_required(self):
  """回归验证explicit keep all required；隔离输入并断言实际成功或拒绝行为。"""
  with self.assertRaisesRegex(ValueError,'explicitly'):self.w.keep_remaining()
  self.assertGreater(self.w.next()['remaining'],0)
 def test_unanswered_setup_cannot_finish(self):
  """回归验证unanswered setup cannot finish；隔离输入并断言实际成功或拒绝行为。"""
  with self.assertRaisesRegex(ValueError,'Unanswered'):self.w.finish()
 def test_voice_branch_filters_irrelevant_fields(self):
  """回归验证voice branch filters irrelevant fields；隔离输入并断言实际成功或拒绝行为。"""
  s=self.w.read();s['config']['tts']['engine']='volc'
  ids={x['id'] for x in self.w.pending(s)}
  self.assertIn('config:tts.voicePolicy.enabled',ids);self.assertNotIn('config:tts.voice',ids);self.assertNotIn('config:tts.customVoiceId',ids)
  s['config']['tts']['voicePolicy']['enabled']=False
  self.assertIn('config:tts.voice',{x['id'] for x in self.w.pending(s)})
  s['config']['tts']['engine']='chatcut'
  ids={x['id'] for x in self.w.pending(s)}
  self.assertIn('config:tts.customVoiceId',ids);self.assertNotIn('config:tts.resourceId',ids)
 def test_platform_selection_rebuilds_detail_questions(self):
  """回归验证platform selection rebuilds detail questions；隔离输入并断言实际成功或拒绝行为。"""
  s=self.w.read();s['reviewed']={x['id']:{'choice':'keep'} for x in steps(s['config'],s['workflow']) if x['id']!='workflow:platforms' and not x['id'].startswith('workflow:platforms.')};self.w.persist(s)
  self.w.answer('workflow:platforms',['微信视频号','新平台'])
  draft=self.w.read()['workflow']['platforms']
  self.assertEqual(draft[0]['titleMaxChars'],16);self.assertEqual(draft[1]['name'],'新平台')
  self.assertTrue(any(x.get('platform')=='新平台' for x in self.w.pending(self.w.read())))
 def test_new_configurable_field_becomes_a_question(self):
  """回归验证new configurable field becomes a question；隔离输入并断言实际成功或拒绝行为。"""
  s=self.w.read();s['config']['render']['customSetting']=3
  self.assertIn('config:render.customSetting',{x['id'] for x in steps(s['config'],s['workflow'])})
 def test_completed_does_not_restart_and_finishes_atomically(self):
  """回归验证completed does not restart and finishes atomically；隔离输入并断言实际成功或拒绝行为。"""
  self.w.answer('config:brand.name','新账号');self.w.keep_remaining(True)
  with patch('subprocess.run') as run:result=self.w.finish()
  run.assert_called_once();self.assertEqual(result['status'],'completed')
  self.assertEqual(load(self.root/'config.json')['brand']['name'],'新账号')
  self.assertEqual(Wizard(self.root).next()['status'],'completed')
  self.assertIsNone(Wizard(self.root).next()['next'])
 def test_sync_failure_restores_original_config(self):
  """回归验证sync failure restores original config；隔离输入并断言实际成功或拒绝行为。"""
  original=(self.root/'config.json').read_bytes()
  self.w.answer('config:brand.name','新账号');self.w.keep_remaining(True)
  with patch('subprocess.run',side_effect=RuntimeError('sync failed')):
   with self.assertRaisesRegex(RuntimeError,'sync failed'):self.w.finish()
  self.assertEqual(load(self.root/'config.json'),self.config)
  self.assertEqual(self.w.read()['status'],'in_progress')
 def test_external_edits_are_not_overwritten(self):
  """回归验证external edits are not overwritten；隔离输入并断言实际成功或拒绝行为。"""
  self.w.keep_remaining(True);c=load(self.root/'config.json');c['brand']['name']='外部修改';save(self.root/'config.json',c)
  with self.assertRaisesRegex(ValueError,'outside this draft'):self.w.finish()
  self.assertEqual(load(self.root/'config.json')['brand']['name'],'外部修改')
 def test_screen_only_default_survives_onboarding(self):
  """回归验证screen only default survives onboarding；隔离输入并断言实际成功或拒绝行为。"""
  self.w.keep_remaining(True)
  self.assertEqual(self.w.read()['config']['writing']['scopeNotes'],'screen-only')

if __name__=='__main__':unittest.main()
