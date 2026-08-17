'use client';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  inFlight?: boolean;
}

/**
 * 二次确认弹窗。危险操作（删除项目、移除成员）强制使用。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  tone = 'default',
  onConfirm,
  onCancel,
  inFlight = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={inFlight}>
            {cancelText}
          </Button>
          <Button
            data-modal-autofocus
            variant={tone === 'danger' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={inFlight}
          >
            {inFlight ? '处理中…' : confirmText}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{description ?? '此操作不可撤销，请谨慎确认。'}</p>
    </Modal>
  );
}
