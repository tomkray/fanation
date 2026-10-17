import React, { useState } from 'react';

/** How to join. On the squeezed layout this stays a small chip so the map stays free. */
export const JoinCard: React.FC<{ readonly onAdvertise: () => void }> = ({ onAdvertise }) => {
  const [open, setOpen] = useState(false);
  return (
    <section className={`glass panel panel--join${open ? ' panel--join--open' : ''}`} aria-label="Como ganhar sua casa">
      <button type="button" className="join__toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Como entrar
      </button>
      {open && (
        <>
          <p className="join__example">
            <span className="join__mention">@seu_idolo</span>
            <span className="caption">ex: @anitta · @flamengo · @whinderssonnunes</span>
          </p>
          <p className="caption">
            Comenta o @ do seu ídolo num post do @naoeumfa. Sua casa nasce do lado dele — e quem comentar o seu @ faz o
            bairro crescer. Spoiler: não é um fã… é dono de terreno.
          </p>
          <button type="button" className="link-button join__advertise" onClick={onAdvertise}>
            Marcas: coloca teu anúncio no zepelim →
          </button>
        </>
      )}
    </section>
  );
};
