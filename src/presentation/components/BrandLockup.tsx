import React from 'react';

export const BrandLockup: React.FC<{ readonly size?: 'md' | 'lg' }> = ({ size = 'md' }) => (
  <span className={`brand-lockup brand-lockup--${size}`}>
    <img className="brand-lockup__mark" src="/brand/fanation-mark.svg" alt="" aria-hidden="true" />
    <span className="brand-lockup__word">
      Fanation<span className="brand-lockup__tld">.club</span>
    </span>
  </span>
);
