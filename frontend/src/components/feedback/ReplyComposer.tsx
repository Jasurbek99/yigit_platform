import { useState } from 'react';
import { Button, Input, Radio, Tooltip, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { ScreenshotInput } from '@/components/feedback/ScreenshotInput';
import { useReplyToTicket } from '@/hooks/useFeedback';
import type { FeedbackReplyMode } from '@/types';

const { TextArea } = Input;
const { Text } = Typography;

interface IReplyComposerProps {
  ticketId: number;
}

export function ReplyComposer({ ticketId }: IReplyComposerProps): React.ReactElement {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<FeedbackReplyMode>('standard');
  const [files, setFiles] = useState<File[]>([]);
  const replyMutation = useReplyToTicket(ticketId);

  async function handleSend(): Promise<void> {
    if (!content.trim()) {
      message.warning(t('feedback.reply.content_required'));
      return;
    }
    await replyMutation.mutateAsync({ content, mode, attachments: files });
    setContent('');
    setMode('standard');
    setFiles([]);
    message.success(t('feedback.reply.sent'));
  }

  const modeOptions = [
    {
      value: 'standard',
      label: t('feedback.reply.mode_standard'),
    },
    {
      value: 'internal',
      label: (
        <Tooltip title={t('feedback.reply.mode_internal_tooltip')}>
          {t('feedback.reply.mode_internal')}
        </Tooltip>
      ),
    },
    {
      value: 'public',
      label: (
        <Tooltip title={t('feedback.reply.mode_public_tooltip')}>
          {t('feedback.reply.mode_public')}
        </Tooltip>
      ),
    },
  ];

  return (
    <div
      style={{
        padding: 16,
        borderTop: '1px solid #f0f0f0',
        background: mode === 'internal' ? '#fffbe6' : undefined,
        borderRadius: mode === 'internal' ? '0 0 8px 8px' : undefined,
      }}
    >
      {mode === 'internal' && (
        <Text
          type="warning"
          style={{ display: 'block', fontSize: 12, marginBottom: 8 }}
        >
          {t('feedback.reply.internal_warning')}
        </Text>
      )}
      {mode === 'public' && (
        <Text
          style={{ display: 'block', fontSize: 12, marginBottom: 8, color: '#1677ff' }}
        >
          {t('feedback.reply.public_warning')}
        </Text>
      )}

      <TextArea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        maxLength={4000}
        showCount
        placeholder={t('feedback.reply.placeholder')}
        style={{ marginBottom: 8 }}
      />

      <div style={{ marginBottom: 8 }}>
        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value as FeedbackReplyMode)}
          size="small"
        >
          {modeOptions.map((opt) => (
            <Radio.Button key={opt.value} value={opt.value}>
              {opt.label}
            </Radio.Button>
          ))}
        </Radio.Group>
      </div>

      <div style={{ marginBottom: 8 }}>
        <ScreenshotInput files={files} onChange={setFiles} />
      </div>

      <Button
        type="primary"
        onClick={handleSend}
        loading={replyMutation.isPending}
      >
        {t('feedback.reply.send')}
      </Button>
    </div>
  );
}
