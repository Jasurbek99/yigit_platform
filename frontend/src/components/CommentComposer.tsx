import { useState } from 'react';
import { Button, Input, Space } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/services/api';

interface ICommentComposerProps {
  shipmentId: number;
}

export function CommentComposer({ shipmentId }: ICommentComposerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit() {
    const trimmed = content.trim();
    if (!trimmed) return;

    setIsLoading(true);
    try {
      await api.post(`/export/shipments/${shipmentId}/comment/`, { content: trimmed });
      setContent('');
      toast.success(t('comments.toast_success'));
      await queryClient.invalidateQueries({ queryKey: ['shipment', String(shipmentId)] });
    } catch {
      toast.error(t('comments.toast_error'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Space.Compact style={{ width: '100%', marginTop: 16 }}>
      <Input.TextArea
        rows={2}
        placeholder={t('comments.placeholder')}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit();
        }}
        style={{ borderRadius: '6px 0 0 6px' }}
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        loading={isLoading}
        disabled={!content.trim()}
        onClick={handleSubmit}
        style={{ height: 'auto', borderRadius: '0 6px 6px 0' }}
      >
        {t('comments.send')}
      </Button>
    </Space.Compact>
  );
}
