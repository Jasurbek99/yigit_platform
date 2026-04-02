import { useState } from 'react';
import { Button, Input, Flex } from 'antd';
import { IconSend } from '@tabler/icons-react';
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
    <Flex gap={8} align="flex-end" style={{ marginTop: 16 }}>
      <Input.TextArea
        style={{ flex: 1 }}
        rows={2}
        placeholder={t('comments.placeholder')}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleSubmit();
        }}
      />
      <Button
        type="primary"
        icon={<IconSend size={14} />}
        loading={isLoading}
        disabled={!content.trim()}
        onClick={() => void handleSubmit()}
      >
        {t('comments.send')}
      </Button>
    </Flex>
  );
}
