import tempfile
from pathlib import Path
from server import bounded_run, process_pdf
import zlib


def pdf(objects):
    data=bytearray(b'%PDF-1.4\n');offsets=[0]
    for n,obj in enumerate(objects,1):
        offsets.append(len(data));data.extend(f'{n} 0 obj\n'.encode()+obj+b'\nendobj\n')
    start=len(data);data.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode());return bytes(data)


def stream(data,attributes=b''):
    return b'<< '+attributes+b' /Length '+str(len(data)).encode()+b' >>\nstream\n'+data+b'\nendstream'


with tempfile.TemporaryDirectory(prefix='smoke-') as folder:
    root=Path(folder)
    content=b'BT /F1 22 Tf 15 50 Td (ANTHRO OCR SMOKE TEST) Tj ET'
    source=pdf([b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 330 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',stream(content)])
    (root/'source.pdf').write_bytes(source)
    bounded_run(['pdftoppm','-singlefile','-r','150','source.pdf','image'],30,root)
    with (root/'image.ppm').open('rb') as image:
        if image.readline().strip()!=b'P6':raise ValueError('Unexpected smoke image format')
        line=image.readline()
        while line.startswith(b'#'):line=image.readline()
        width,height=map(int,line.split())
        if image.readline().strip()!=b'255':raise ValueError('Unexpected smoke depth')
        pixels=image.read()
    assert len(pixels)==width*height*3
    # This PDF contains only raster pixels, no searchable text layer.
    raster=pdf([b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 330 100] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',stream(zlib.compress(pixels),f'/Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode'.encode()),stream(b'q 330 0 0 100 0 0 cm /Im1 Do Q')])
    result=process_pdf(raster)
    assert 'ANTHRO' in result.upper(), 'OCR smoke text was not recognized'
print('PASS: Poppler raster rendering and real Tesseract OCR on an image-only PDF.')
