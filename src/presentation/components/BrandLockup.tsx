import React from 'react';

export const BrandLockup: React.FC<{ readonly size?: 'md' | 'lg' }> = ({ size = 'md' }) => (
  <span className={`brand-lockup brand-lockup--${size}`}>
    <img className="brand-lockup__mark" src="/brand/naoeumfa-mark.svg" width="32" height="32" alt="" aria-hidden="true" />
    <span className="brand-lockup__word">
      naoeumfa<span className="brand-lockup__tld">.com</span>
    </span>
  </span>
);
