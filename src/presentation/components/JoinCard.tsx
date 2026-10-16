import React from 'react';

export const JoinCard: React.FC<{ readonly onAdvertise: () => void }> = ({ onAdvertise }) => (
  <section className="glass panel panel--join" aria-label="How to get your home">
    <span className="eyebrow">How to join the city</span>
    <p className="join__example">
      <span className="join__mention">@your_idol</span>
      <span className="caption">e.g. @taylorswift · @realmadrid · @mrbeast</span>
    </p>
    <p className="caption">
      Comment your idol&apos;s @ on a @fanation.club post. Your home is built next to them, and anyone who comments your @
      makes your home and your own neighbourhood grow.
    </p>
    <button type="button" className="link-button join__advertise" onClick={onAdvertise}>
      Brands: put your ad on a zeppelin →
    </button>
  </section>
);
