import unittest
import importlib.util
from pathlib import Path
import tempfile
import threading
import http.client
import sys
from types import SimpleNamespace
from unittest.mock import patch

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

class OcrHealth(unittest.TestCase):
    def test_authenticated_health_and_native_smoke_boundaries(self):
        class Handler(module.Handler):
            token='t'*32
            engine='Fictional native fixture'
        server=module.HTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(method,path,headers=None,body=None):
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
            conn.request(method,path,body=body,headers=headers or {})
            response=conn.getresponse();result=(response.status,response.read());conn.close();return result
        try:
            self.assertEqual(request('GET','/health')[0],403)
            headers={'Authorization':'Bearer '+Handler.token}
            self.assertEqual(request('GET','/health',headers)[0],200)
            self.assertEqual(request('POST','/smoke')[0],403)
            with patch.dict(sys.modules,{'smoke':SimpleNamespace(run_smoke=lambda:True)}):
                self.assertEqual(request('POST','/smoke',headers)[0],200)
                self.assertEqual(request('POST','/smoke',headers,b'x')[0],413)
            def fail():raise ValueError('Secret internal path')
            with patch.dict(sys.modules,{'smoke':SimpleNamespace(run_smoke=fail)}):
                status,body=request('POST','/smoke',headers)
                self.assertEqual(status,422);self.assertNotIn(b'Secret',body)
        finally:
            server.shutdown();server.server_close();thread.join(timeout=3)

if __name__=='__main__':unittest.main()
