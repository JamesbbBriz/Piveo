import React from 'react';
import { Button } from '@/components/base/buttons/button';

interface GenerateCtaProps {
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export const GenerateCta: React.FC<GenerateCtaProps> = ({ disabled = false, loading = false, onClick }) => {
  return (
    <Button
      size="lg"
      color="primary"
      type="button"
      isDisabled={disabled || loading}
      isLoading={loading}
      onClick={onClick}
      className="w-full piveo-spring-strong"
    >
      Generate Images + Video / 生成套图 + 视频
    </Button>
  );
};
