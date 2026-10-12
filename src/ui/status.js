'use strict';

const parameters = new URLSearchParams(location.search);
const failed = parameters.get('state') === 'error';
const kind = parameters.get('kind');
document.body.classList.toggle('error', failed);
const labels = {
  startup: 'No se pudo iniciar la aplicación',
  server: 'El servidor se ha detenido',
  page: 'La vista web no está disponible'
};
document.getElementById('label').textContent = failed ? labels[kind] ?? labels.startup : 'Arrancando';
document.getElementById('title').textContent = parameters.get('title') || 'WebBox';
document.getElementById('message').textContent = parameters.get('message') || '';
const details = document.getElementById('details');
details.textContent = parameters.get('details') || '';
details.hidden = !details.textContent;
document.getElementById('hint').hidden = !failed;
const reload = document.getElementById('reload');
reload.hidden = !failed || parameters.get('reload') !== 'true';
reload.addEventListener('click', () => {
  reload.disabled = true;
  window.webboxStatus.reloadPage();
});
