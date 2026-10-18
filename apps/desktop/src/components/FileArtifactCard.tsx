import { Icon } from './Icon';

function fileExtension(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  return /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'file';
}

function fileTypeLabel(fileName: string, mimeType?: string | null) {
  const extension = fileExtension(fileName).toUpperCase();
  if (mimeType?.startsWith('image/')) return `${extension} image`;
  if (mimeType?.startsWith('audio/')) return `${extension} audio`;
  if (mimeType?.startsWith('video/')) return `${extension} video`;
  if (mimeType === 'application/pdf' || extension === 'PDF') return 'PDF document';
  if (['XLS', 'XLSX', 'CSV', 'ODS'].includes(extension)) return 'Spreadsheet';
  if (['DOC', 'DOCX', 'ODT', 'RTF'].includes(extension)) return 'Word document';
  if (['ZIP', '7Z', 'RAR', 'TAR', 'GZ'].includes(extension)) return 'Archive';
  if (['JS', 'TS', 'JSON', 'XML', 'HTML', 'CSS', 'PY', 'RS', 'SQL'].includes(extension)) return 'Data or source file';
  return extension === 'FILE' ? 'File attachment' : `${extension} file`;
}

function fileIconName(fileName: string, mimeType?: string | null) {
  const extension = fileExtension(fileName);
  if (mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'scan';
  if (['csv', 'xls', 'xlsx', 'ods'].includes(extension)) return 'table';
  return 'file';
}

export interface FileArtifactCardProps {
  fileName: string;
  mimeType?: string | null;
  sizeText?: string;
  modifiedText?: string;
  statusText?: string;
  detailText?: string;
  previewUrl?: string;
  openLabel?: string;
  retryLabel?: string;
  opening?: boolean;
  retrying?: boolean;
  className?: string;
  onOpen?: () => void;
  onRetry?: () => void;
  onDelete?: () => void;
}

export function FileArtifactCard({
  fileName,
  mimeType,
  sizeText,
  modifiedText,
  statusText,
  detailText,
  previewUrl,
  openLabel = 'Open',
  retryLabel = 'Retry',
  opening = false,
  retrying = false,
  className = '',
  onOpen,
  onRetry,
  onDelete,
}: FileArtifactCardProps) {
  const extension = fileExtension(fileName);
  const typeLabel = fileTypeLabel(fileName, mimeType);
  const fileInfo = [detailText || typeLabel, sizeText, modifiedText].filter(Boolean).join(' · ');
  const Main = onOpen ? 'button' : 'div';

  return (
    <article className={`file-artifact-card ext-${extension} ${className}`.trim()}>
      <Main
        className="file-artifact-main"
        {...(onOpen ? { type: 'button' as const, onClick: onOpen, title: `Open ${fileName}` } : {})}
        aria-label={onOpen ? `Open ${fileName}` : undefined}
      >
        {previewUrl ? (
          <span className="file-artifact-preview"><img src={previewUrl} alt="" loading="lazy" /></span>
        ) : (
          <span className="file-artifact-icon">
            <Icon name={fileIconName(fileName, mimeType)} size={21} />
            <small>{extension.slice(0, 4).toUpperCase() || 'FILE'}</small>
          </span>
        )}
        <span className="file-artifact-copy">
          <b title={fileName}>{fileName}</b>
          <small>{fileInfo}</small>
          {statusText && <small className="file-artifact-status">{statusText}</small>}
        </span>
      </Main>
      {(onOpen || onRetry || onDelete) && (
        <span className="file-artifact-actions">
          {onRetry && (
            <button type="button" className="file-artifact-action" onClick={onRetry} disabled={retrying} aria-label={`${retryLabel} ${fileName}`}>
              {retrying ? <span className="spin" /> : <Icon name="refresh" size={14} />}
              <span>{retrying ? 'Retrying…' : retryLabel}</span>
            </button>
          )}
          {onOpen && (
            <button type="button" className="file-artifact-action primary" onClick={onOpen} disabled={opening} aria-label={`${openLabel} ${fileName}`}>
              {opening ? <span className="spin" /> : <Icon name="file" size={14} />}
              <span>{opening ? 'Opening…' : openLabel}</span>
            </button>
          )}
          {onDelete && (
            <button type="button" className="file-artifact-delete" onClick={onDelete} aria-label={`Delete ${fileName}`} title={`Delete ${fileName}`}>
              <Icon name="trash" size={14} />
            </button>
          )}
        </span>
      )}
    </article>
  );
}
