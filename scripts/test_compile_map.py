import importlib.util
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name('compile-map.py')
SPEC = importlib.util.spec_from_file_location('compile_map', MODULE_PATH)
compile_map = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(compile_map)


class MapFallbackTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name)

    def write_map(self, valid=True):
        for name, count in (('roads', 100), ('areas', 100), ('places', 1)):
            features = [{}] * (count if valid else 0)
            (self.output / f'{name}.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': features}))

    def test_keeps_valid_existing_map_after_network_failure(self):
        self.write_map()
        original = {path.name: path.read_bytes() for path in self.output.iterdir()}
        with patch.object(compile_map, 'OUTPUT_DIR', self.output), \
                patch.object(compile_map.urllib.request, 'urlopen', side_effect=urllib.error.URLError('Gateway Timeout')):
            compile_map.main(keep_existing_on_fetch_error=True)
        self.assertEqual(original, {path.name: path.read_bytes() for path in self.output.iterdir()})

    def test_rejects_unusable_existing_map(self):
        self.write_map(valid=False)
        with patch.object(compile_map, 'OUTPUT_DIR', self.output), \
                patch.object(compile_map.urllib.request, 'urlopen', side_effect=urllib.error.URLError('Gateway Timeout')):
            with self.assertRaises(urllib.error.URLError):
                compile_map.main(keep_existing_on_fetch_error=True)


if __name__ == '__main__':
    unittest.main()
