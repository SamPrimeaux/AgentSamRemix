import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export const RedirectHealthToAnalytics: React.FC = () => {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/dashboard/analytics', { replace: true });
  }, [navigate]);
  return null;
};
