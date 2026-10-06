import unittest
import importlib.util
from pathlib import Path
import tempfile

spec=importlib.util.spec_from_file_location('private_ocr',Path(__file__).resolve().parents[1]/'scanner/ocr/server.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class OcrBounds(unittest.TestCase):
    def test_pdf_signature_and_size(self):
        for data in [b'',b'not-pdf',b'%PDF-'+b'x'*module.MAX_BYTES]:
            with self.assertRaises(ValueError):module.process_pdf(data,run=lambda *args:self.fail('Invalid bytes reached a tool'))
    def test_page_limit_prevents_rendering(self):
        calls=[]
        def run(args,timeout,cwd):calls.append(args);return 'Pages: 11\n'
        with self.assertRaises(ValueError):module.process_pdf(b'%PDF-1.4',run=run)
        self.assertEqual(len(calls),1)
        with self.assertRaises(ValueError):
            module.process_pdf(b'%PDF-1.4',run=lambda *args:'Pages: 1\nPages: 100\n')
    def test_tools_are_bounded_fixed_args_and_temp_files_removed(self):
        calls=[];roots=[]
        def run(args,timeout,cwd):
            calls.append((args,timeout));roots.append(cwd)
            if args[0]=='pdfinfo':return 'Pages: 2\n'
            if args[0]=='pdftoppm':
                (cwd/'page-1.png').write_bytes(b'fake');(cwd/'page-2.png').write_bytes(b'fake');return ''
            self.assertEqual(args[0],'tesseract');self.assertIn('eng',args);return 'Jane Smith\n'
        self.assertEqual(module.process_pdf(b'%PDF-1.4',run=run),'Jane Smith\n\nJane Smith')
        self.assertIn('1600',calls[1][0]);self.assertTrue(all(timeout<=30 for _,timeout in calls))
        self.assertTrue(all(not root.exists() for root in roots))
    def test_incomplete_rendering_and_large_text(self):
        def incomplete(args,timeout,cwd):return 'Pages: 1' if args[0]=='pdfinfo' else ''
        with self.assertRaises(ValueError):module.process_pdf(b'%PDF-1.4',run=incomplete)
        def large(args,timeout,cwd):
            if args[0]=='pdfinfo':return 'Pages: 1'
            if args[0]=='pdftoppm':(cwd/'page-1.png').write_bytes(b'fake');return ''
            return 'x'*50000
        self.assertEqual(len(module.process_pdf(b'%PDF-1.4',run=large)),40000)

if __name__=='__main__':unittest.main()
