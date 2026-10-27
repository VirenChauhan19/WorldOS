// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { exportJSON } from './exportFile';
vi.mock('@capacitor/filesystem',()=>({Filesystem:{writeFile:vi.fn(),deleteFile:vi.fn()},Directory:{Cache:'CACHE'},Encoding:{UTF8:'utf8'}}));
vi.mock('@capacitor/share',()=>({Share:{share:vi.fn()}}));
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();});
it.each([false,true])('cleans the temporary native report when sharing rejects=%s',async rejected=>{
  vi.spyOn(Capacitor,'isNativePlatform').mockReturnValue(true);
  vi.mocked(Filesystem.writeFile).mockResolvedValue({uri:'file:///cache/report.json'});vi.mocked(Filesystem.deleteFile).mockResolvedValue();
  vi.mocked(Share.share).mockImplementation(async()=>{if(rejected)throw new Error('share failed');return {};});
  const pending=exportJSON({result:'review_required'},'trial.json');
  if(rejected)await expect(pending).rejects.toThrow('share failed');else await pending;
  expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({files:['file:///cache/report.json']}));
  expect(Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({directory:'CACHE',encoding:'utf8'}));
  expect(Filesystem.deleteFile).toHaveBeenCalledWith(expect.objectContaining({directory:'CACHE'}));
});
