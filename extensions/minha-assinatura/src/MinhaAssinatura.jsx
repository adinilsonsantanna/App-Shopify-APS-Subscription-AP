export default async () => {
  const page = document.createElement('s-page');
  page.setAttribute('heading', 'Minha Assinatura');

  const banner = document.createElement('s-banner');
  banner.setAttribute('tone', 'neutral');
  banner.textContent = 'DIAGNÓSTICO APS: EXTENSÃO EXECUTADA';

  page.appendChild(banner);
  document.body.appendChild(page);
};
