import { expect, it, vi } from 'vitest';
import { brandedQRDataUrl, eventJoinUrl, eventQRSettings, EVENT_QR_DOWNLOAD_SIZE } from './eventQR';
it.each(['GUESTQB','Z57YRB'])('QR/copy/export use the current origin for %s',code=>{
  expect(eventJoinUrl('https://staging.example.test',code)).toBe(`https://staging.example.test/join?code=${code}`);
});
it.each([160,260,EVENT_QR_DOWNLOAD_SIZE])('uses H, four internal modules and conservative excavated official logo at %s',size=>{
 const settings=eventQRSettings(size);expect(settings.level).toBe('H');expect(settings.marginSize).toBe(4);expect(settings.imageSettings.excavate).toBe(true);expect(settings.imageSettings.width).toBe(size*0.18);expect(settings.imageSettings.src).toBe('/brand/decks-event-qr-logo.png');
});
it('fails closed for missing/unloaded logo instead of exporting an unbranded QR',async()=>{
 const wrap=document.createElement('div');wrap.innerHTML='<canvas></canvas><img />';
 await expect(brandedQRDataUrl(wrap)).rejects.toThrow('not loaded');await expect(brandedQRDataUrl(null)).rejects.toThrow('not loaded');
});
function loadedWrap(){const wrap=document.createElement('div');wrap.innerHTML='<canvas></canvas><img />';const image=wrap.querySelector('img');if(!image)throw Error('fixture');Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:768},naturalHeight:{value:768}});image.decode=vi.fn().mockResolvedValue(undefined);return wrap;}
it('waits for logo decode/paint and propagates tainted export failure',async()=>{
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1;});
 const wrap=loadedWrap(),canvas=wrap.querySelector('canvas');if(!canvas)throw Error('fixture');canvas.toDataURL=vi.fn(()=>{throw new DOMException('tainted','SecurityError');});await expect(brandedQRDataUrl(wrap)).rejects.toThrow('tainted');vi.unstubAllGlobals();
});
it('exports PNG only after loaded logo is decoded',async()=>{
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1;});const wrap=loadedWrap(),canvas=wrap.querySelector('canvas');if(!canvas)throw Error('fixture');canvas.toDataURL=vi.fn(()=> 'data:image/png;base64,valid');expect(await brandedQRDataUrl(wrap)).toBe('data:image/png;base64,valid');expect(wrap.querySelector('img')?.decode).toHaveBeenCalledOnce();vi.unstubAllGlobals();
});
it('decode failure never reaches PNG export',async()=>{const wrap=loadedWrap(),canvas=wrap.querySelector('canvas'),image=wrap.querySelector('img');if(!canvas||!image)throw Error('fixture');image.decode=vi.fn().mockRejectedValue(new Error('decode failed'));canvas.toDataURL=vi.fn();await expect(brandedQRDataUrl(wrap)).rejects.toThrow('decode failed');expect(canvas.toDataURL).not.toHaveBeenCalled();});