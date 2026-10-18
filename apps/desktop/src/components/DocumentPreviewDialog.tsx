import { useEffect, useState } from 'react';
import { Icon } from './Icon';

function resolveMimeType(fileName: string, mimeType?: string | null, fileType?: string) {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
  if (fileType && fileType !== 'application/octet-stream') return fileType;
  const extension = fileName.split('.').pop()?.toLowerCase();
  const knownTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
  };
  return extension ? knownTypes[extension] || 'application/octet-stream' : 'application/octet-stream';
}

export function DocumentPreviewDialog({
  file,
  fileName,
  mimeType,
  onClose,
  onOpenNative,
  openingNative = false,
  nativeError = '',
}: {
  file: Blob;
  fileName: string;
  mimeType?: string | null;
  onClose: () => void;
  onOpenNative?: () => void;
  openingNative?: boolean;
  nativeError?: string;
}) {
  const [url, setUrl] = useState('');
  const [textPreview, setTextPreview] = useState('');
  const [textPreviewError, setTextPreviewError] = useState('');
  const resolvedMimeType = resolveMimeType(fileName, mimeType, file.type);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    if (!['text/plain', 'text/csv', 'application/json'].includes(resolvedMimeType)) return undefined;
    let active = true;
    setTextPreview('');
    setTextPreviewError('');
    void file.slice(0, 2 * 1024 * 1024).text()
      .then((text) => { if (active) setTextPreview(text); })
      .catch(() => { if (active) setTextPreviewError('Text preview could not be read. Download the original file instead.'); });
    return () => { active = false; };
  }, [file, resolvedMimeType]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="tg-file-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${fileName}`}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="tg-file-preview">
        <header className="tg-file-preview-header">
          <div><Icon name="file" size={17} /><b title={fileName}>{fileName}</b></div>
          <div>
            {onOpenNative && (
              <button type="button" className="btn sm" onClick={onOpenNative} disabled={openingNative}>
                {openingNative ? <span className="spin" /> : <Icon name="open" size={13} />}
                {openingNative ? 'Opening…' : 'Open with default app'}
              </button>
            )}
            <a className="btn sm" href={url || undefined} download={fileName}><Icon name="download" size={13} />Download</a>
            <button type="button" className="btn sm gh" onClick={onClose} aria-label="Close file preview"><Icon name="x" size={16} /></button>
          </div>
        </header>
        {nativeError && <div className="tg-file-preview-error" role="alert">{nativeError}</div>}
        <div className="tg-file-preview-content">
          {!url ? (
            <div className="tg-file-preview-loading"><span className="spin" />Preparing preview…</div>
          ) : resolvedMimeType.startsWith('image/') ? (
            <img src={url} alt={fileName} />
          ) : resolvedMimeType === 'application/pdf' ? (
            <iframe src={url} title={`PDF preview: ${fileName}`} />
          ) : resolvedMimeType.startsWith('video/') ? (
            <video src={url} controls aria-label={fileName} />
          ) : resolvedMimeType.startsWith('audio/') ? (
            <audio src={url} controls aria-label={fileName} />
          ) : resolvedMimeType === 'text/plain' || resolvedMimeType === 'text/csv' || resolvedMimeType === 'application/json' ? (
            textPreviewError
              ? <div className="tg-file-preview-fallback">{textPreviewError}</div>
              : <pre className="document-text-preview">{textPreview}{file.size > 2 * 1024 * 1024 ? '\n\nPreview limited to the first 2 MB. Download the file to view the rest.' : ''}</pre>
          ) : (
            <div className="tg-file-preview-fallback">
              <span><Icon name="file" size={26} /></span>
              <b>Inline preview is not available for this file type</b>
              <small>
                {onOpenNative
                  ? 'Open the original with an application installed on this device, or download it.'
                  : 'Download the original file to open it on this device.'}
              </small>
              {onOpenNative && (
                <button type="button" className="btn pri sm" onClick={onOpenNative} disabled={openingNative}>
                  <Icon name="open" size={13} />Open with default app
                </button>
              )}
              <a className="btn sm" href={url} download={fileName}><Icon name="download" size={13} />Download file</a>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
