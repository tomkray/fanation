import React from 'react';

export const JoinCard: React.FC<{ readonly onAdvertise: () => void }> = ({ onAdvertise }) => (
  <section className="glass panel panel--join" aria-label="Como ganhar sua casa">
    <span className="eyebrow">Como entrar na cidade</span>
    <p className="join__example">
      <span className="join__mention">@seu_idolo</span>
      <span className="caption">ex: @anitta · @flamengo · @whinderssonnunes</span>
    </p>
    <p className="caption">
      Comenta o @ do seu ídolo num post do @naoeumfa. Sua casa nasce do lado dele — e quem comentar o seu @ faz o bairro
      crescer. Spoiler: não é um fã… é dono de terreno.
    </p>
    <button type="button" className="link-button join__advertise" onClick={onAdvertise}>
      Marcas: coloca teu anúncio no zepelim →
    </button>
  </section>
);
