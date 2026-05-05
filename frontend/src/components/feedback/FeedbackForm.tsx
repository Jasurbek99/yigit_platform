import { useState } from 'react';
import { Form, Input, Select, Typography, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ScreenshotInput } from '@/components/feedback/ScreenshotInput';
import { useCreateFeedbackTicket } from '@/hooks/useFeedback';
import type { FeedbackCategory } from '@/types';

const { TextArea } = Input;
const { Text } = Typography;

interface IFeedbackFormValues {
  category: FeedbackCategory;
  title: string;
  description: string;
}

interface IFeedbackFormProps {
  /** Pre-filled path for submitted_from_path */
  fromPath?: string;
  /** Called after successful submit (e.g. to close a modal) */
  onSuccess?: () => void;
  /** If false, the form will NOT navigate to /feedback/my-tickets on success */
  navigateOnSuccess?: boolean;
}

export function FeedbackForm({
  fromPath = '',
  onSuccess,
  navigateOnSuccess = true,
}: IFeedbackFormProps): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm<IFeedbackFormValues>();
  const [files, setFiles] = useState<File[]>([]);
  const createMutation = useCreateFeedbackTicket();

  const categoryOptions = [
    { value: 'bug', label: t('feedback.category.bug') },
    { value: 'suggestion', label: t('feedback.category.suggestion') },
    { value: 'question', label: t('feedback.category.question') },
  ];

  async function handleSubmit(values: IFeedbackFormValues): Promise<void> {
    await createMutation.mutateAsync({
      category: values.category,
      title: values.title,
      description: values.description,
      submitted_from_path: fromPath,
      user_agent: navigator.userAgent,
      attachments: files,
    });
    form.resetFields();
    setFiles([]);
    onSuccess?.();
    if (navigateOnSuccess) {
      navigate('/feedback/my-tickets');
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      requiredMark={false}
    >
      <Form.Item
        name="category"
        label={t('feedback.form.category')}
        rules={[{ required: true, message: t('feedback.form.category_required') }]}
      >
        <Select
          options={categoryOptions}
          placeholder={t('feedback.form.category_placeholder')}
        />
      </Form.Item>

      <Form.Item
        name="title"
        label={t('feedback.form.title')}
        rules={[
          { required: true, message: t('feedback.form.title_required') },
          { max: 200, message: t('feedback.form.title_max') },
        ]}
      >
        <Input
          placeholder={t('feedback.form.title_placeholder')}
          maxLength={200}
          showCount
        />
      </Form.Item>

      <Form.Item
        name="description"
        label={t('feedback.form.description')}
        rules={[
          { required: true, message: t('feedback.form.description_required') },
          { max: 4000, message: t('feedback.form.description_max') },
        ]}
      >
        <TextArea
          rows={5}
          maxLength={4000}
          showCount
          placeholder={t('feedback.form.description_placeholder')}
        />
      </Form.Item>

      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('feedback.form.hint_1')}
        </Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('feedback.form.hint_2')}
        </Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('feedback.form.hint_3')}
        </Text>
      </div>

      <Form.Item label={t('feedback.form.attachments')}>
        <ScreenshotInput files={files} onChange={setFiles} />
      </Form.Item>

      <Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          loading={createMutation.isPending}
          block
        >
          {t('feedback.form.submit')}
        </Button>
      </Form.Item>

      {createMutation.isError && (
        <Text type="danger" style={{ fontSize: 12 }}>
          {t('feedback.form.submit_error')}
        </Text>
      )}
    </Form>
  );
}
