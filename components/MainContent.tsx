import React from 'react';
import { Icon } from './Icon';
import { ImageGallery, type ImageGalleryProps } from './ImageGallery';
import { ProjectList, type ProjectListProps } from './ProjectList';

interface MainContentProps {
  navView: string;
  children?: React.ReactNode;
  galleryProps?: ImageGalleryProps;
  projectListProps?: ProjectListProps;
  settingsElement?: React.ReactNode;
  assetsElement?: React.ReactNode;
  modelsElement?: React.ReactNode;
  productsElement?: React.ReactNode;
  teamElement?: React.ReactNode;
  adminElement?: React.ReactNode;
}

const PlaceholderView: React.FC<{ icon: string; title: string; subtitle: string }> = ({ icon, title, subtitle }) => (
  <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
    <Icon name={icon} className="text-5xl mb-4 opacity-30" />
    <p className="text-lg font-medium text-gray-400">{title}</p>
    <p className="text-sm text-gray-600 mt-1">{subtitle}</p>
  </div>
);

export const MainContent: React.FC<MainContentProps> = ({ navView, children, galleryProps, projectListProps, settingsElement, assetsElement, modelsElement, productsElement, teamElement, adminElement }) => {
  switch (navView) {
    case 'project':
      return <>{children}</>;

    case 'gallery':
      if (galleryProps) {
        return <ImageGallery {...galleryProps} />;
      }
      return <PlaceholderView icon="images" title="图片库" subtitle="暂无图片" />;

    case 'projects':
      if (projectListProps) {
        return <ProjectList {...projectListProps} />;
      }
      return <PlaceholderView icon="th-large" title="项目列表" subtitle="暂无项目" />;

    case 'assets':
      if (assetsElement) {
        return <>{assetsElement}</>;
      }
      return <PlaceholderView icon="images" title="素材库" subtitle="即将推出" />;

    case 'models':
      if (modelsElement) {
        return <>{modelsElement}</>;
      }
      return <PlaceholderView icon="users" title="模特库" subtitle="即将推出" />;

    case 'products':
      if (productsElement) {
        return <>{productsElement}</>;
      }
      return <PlaceholderView icon="cube" title="产品库" subtitle="即将推出" />;

    case 'settings':
      if (settingsElement) {
        return <>{settingsElement}</>;
      }
      return <PlaceholderView icon="gear" title="设置" subtitle="即将推出" />;

    case 'team':
      if (teamElement) {
        return <>{teamElement}</>;
      }
      return <PlaceholderView icon="users" title="团队管理" subtitle="即将推出" />;

    case 'admin':
      if (adminElement) {
        return <>{adminElement}</>;
      }
      return <PlaceholderView icon="shield-halved" title="系统管理" subtitle="无权限" />;

    default:
      return <>{children}</>;
  }
};
