import * as React from 'react';

export interface IFailoverErrorBannerProps {
  errorMessage?: string;
}

export const FailoverErrorBanner: React.FC<IFailoverErrorBannerProps> = () => {
  return (
    <div style={{
      padding: '24px',
      backgroundColor: '#fdf3f2',
      border: '1px solid #f1d7d5',
      color: '#a80000',
      borderRadius: '6px',
      fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
      margin: '16px 0',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
    }}>
      <h3 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px' }}>
        <span>⚠️</span> Service Temporarily Unavailable
      </h3>
      <p style={{ margin: 0, lineHeight: '1.5', fontSize: '14px' }}>
        We are currently unable to connect to the backend services or data sources. Please try again later or contact your system administrator if the issue persists.
      </p>
    </div>
  );
};

export default FailoverErrorBanner;