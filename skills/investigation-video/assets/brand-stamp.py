"""调查封面兼容入口，统一使用仓库配置与已核验字体。"""
from pathlib import Path
import runpy
if __name__=='__main__':
 runpy.run_path(str(Path(__file__).resolve().parents[3]/'scripts/brand_stamp.py'),run_name='__main__')
