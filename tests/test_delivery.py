"""检查交付来源边界，避免私有配置或外部文件混入公开交付。"""
from pathlib import Path
import tempfile, unittest, sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from finalize_outputs import inside

class DeliveryBoundaryTests(unittest.TestCase):
    def test_reject_outside_and_credentials(self):
        """真实创建内外文件，断言路径穿越和凭据文件都被拒绝。"""
        area=ROOT/'.local/tests';area.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=area) as name:
            base=Path(name);project=base/'episode';project.mkdir()
            (base/'outside.txt').write_text('outside')
            (project/'.env').write_text('not a real credential')
            (project/'script.txt').write_text('public')
            self.assertEqual(inside(project,'script.txt'),project/'script.txt')
            with self.assertRaises(ValueError):inside(project,'../outside.txt')
            with self.assertRaises(ValueError):inside(project,'.env')

if __name__=='__main__':unittest.main()
