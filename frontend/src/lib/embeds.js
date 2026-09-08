/**
 * Gerador dos códigos de implementação dos formulários (módulo de embeds).
 * Os snippets são autossuficientes: capturam UTMs da URL, persistem em
 * sessionStorage (não se perdem em navegação interna), anexam _referrer,
 * _pagina e o honeypot _gotcha, e enviam ao endpoint público de captura.
 *
 * Contrato do payload: ver backend/README.md.
 */

const CHAVES_UTM = "['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']";

// Bloco compartilhado de captura de UTMs (vanilla, ES5 para máxima compatibilidade)
function blocoColetarUtms() {
  return [
    `  var CHAVES_UTM = ${CHAVES_UTM};`,
    '  function coletarUtms() {',
    '    var utms = {};',
    "    try { utms = JSON.parse(sessionStorage.getItem('lf_utms') || '{}'); } catch (e) {}",
    '    var parametros = new URLSearchParams(window.location.search);',
    '    CHAVES_UTM.forEach(function (chave) {',
    '      var valor = parametros.get(chave);',
    '      if (valor) utms[chave] = valor;',
    '    });',
    "    try { sessionStorage.setItem('lf_utms', JSON.stringify(utms)); } catch (e) {}",
    '    return utms;',
    '  }',
  ].join('\n');
}

function atributosHtml(campo) {
  const partes = [`name="${campo.nome_campo}"`];
  if (campo.placeholder) partes.push(`placeholder="${campo.placeholder}"`);
  if (campo.obrigatorio) partes.push('required');
  return partes.join(' ');
}

const TIPO_INPUT = { texto: 'text', email: 'email', telefone: 'tel', numero: 'number', data: 'date', oculto: 'hidden' };

function campoHtml(campo) {
  const id = `lf-${campo.nome_campo}`;
  if (campo.tipo === 'oculto') return `  <input type="hidden" ${atributosHtml(campo)}>`;

  const rotulo = `    <label for="${id}">${campo.rotulo}</label>`;
  let controle;
  if (campo.tipo === 'textarea') {
    controle = `    <textarea id="${id}" ${atributosHtml(campo)}></textarea>`;
  } else if (campo.tipo === 'select') {
    const opcoes = (lerOpcoes(campo) || []).map((opcao) => `      <option value="${opcao}">${opcao}</option>`);
    controle = [`    <select id="${id}" ${atributosHtml(campo)}>`, '      <option value="">Selecione…</option>', ...opcoes, '    </select>'].join('\n');
  } else if (campo.tipo === 'checkbox') {
    return [`  <div class="lf-campo lf-checkbox">`, `    <label><input type="checkbox" ${atributosHtml(campo)} value="sim"> ${campo.rotulo}</label>`, '  </div>'].join('\n');
  } else {
    controle = `    <input id="${id}" type="${TIPO_INPUT[campo.tipo] || 'text'}" ${atributosHtml(campo)}>`;
  }
  return ['  <div class="lf-campo">', rotulo, controle, '  </div>'].join('\n');
}

function lerOpcoes(campo) {
  if (Array.isArray(campo.opcoes_json)) return campo.opcoes_json;
  try {
    return JSON.parse(campo.opcoes_json || '[]');
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// React / código puro
// ---------------------------------------------------------------------------

function campoJsx(campo) {
  const atributos = [`name="${campo.nome_campo}"`];
  if (campo.placeholder) atributos.push(`placeholder="${campo.placeholder}"`);
  if (campo.obrigatorio) atributos.push('required');
  const atr = atributos.join(' ');

  if (campo.tipo === 'oculto') return `      <input type="hidden" ${atr} />`;
  if (campo.tipo === 'textarea') {
    return [`      <label>${campo.rotulo}`, `        <textarea ${atr} />`, '      </label>'].join('\n');
  }
  if (campo.tipo === 'select') {
    const opcoes = (lerOpcoes(campo) || []).map((opcao) => `          <option value="${opcao}">${opcao}</option>`);
    return [`      <label>${campo.rotulo}`, `        <select ${atr}>`, '          <option value="">Selecione…</option>', ...opcoes, '        </select>', '      </label>'].join('\n');
  }
  if (campo.tipo === 'checkbox') {
    return `      <label><input type="checkbox" ${atr} value="sim" /> ${campo.rotulo}</label>`;
  }
  return [`      <label>${campo.rotulo}`, `        <input type="${TIPO_INPUT[campo.tipo] || 'text'}" ${atr} />`, '      </label>'].join('\n');
}

export function gerarSnippetReact({ apiUrl, formKey, campos }) {
  return [
    "import { useState, useRef } from 'react';",
    '',
    `const API = '${apiUrl}';`,
    `const FORM_KEY = '${formKey}';`,
    blocoColetarUtms().replace(/^ {2}/gm, ''),
    "const gerarIdem = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));",
    '',
    'export default function FormularioLeadFlow() {',
    "  const [estado, setEstado] = useState({ enviando: false, mensagem: '', erro: '' });",
    '  const idemRef = useRef(gerarIdem());',
    '',
    '  async function enviar(evento) {',
    '    evento.preventDefault();',
    '    const formulario = evento.target;',
    '    const dados = Object.fromEntries(new FormData(formulario));',
    '    dados._utm = coletarUtms();',
    '    dados._referrer = document.referrer;',
    '    dados._pagina = window.location.href;',
    '    dados._idem = idemRef.current;',
    "    setEstado({ enviando: true, mensagem: '', erro: '' });",
    '    try {',
    "      const resposta = await fetch(API + '/api/captura/' + FORM_KEY, {",
    "        method: 'POST',",
    "        headers: { 'Content-Type': 'application/json' },",
    '        body: JSON.stringify(dados),',
    '      });',
    '      const corpo = await resposta.json();',
    "      if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível enviar');",
    '      if (corpo.redirect_url) { window.location.href = corpo.redirect_url; return; }',
    '      formulario.reset();',
    "      setEstado({ enviando: false, mensagem: corpo.mensagem, erro: '' });",
    '    } catch (erro) {',
    "      setEstado({ enviando: false, mensagem: '', erro: erro.message });",
    '    }',
    '  }',
    '',
    '  return (',
    '    <form onSubmit={enviar}>',
    '      {/* honeypot anti-spam — não remova */}',
    '      <input type="text" name="_gotcha" style={{ display: \'none\' }} tabIndex={-1} autoComplete="off" />',
    ...campos.map(campoJsx),
    '      <button type="submit" disabled={estado.enviando}>',
    "        {estado.enviando ? 'Enviando…' : 'Enviar'}",
    '      </button>',
    '      {estado.mensagem && <p>{estado.mensagem}</p>}',
    '      {estado.erro && <p>{estado.erro}</p>}',
    '    </form>',
    '  );',
    '}',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// WordPress / GreatPages — HTML nativo + script de interceptação no rodapé
// ---------------------------------------------------------------------------

export function gerarHtmlFormulario({ campos, idFormulario = 'leadflow-form' }) {
  return [
    `<form id="${idFormulario}">`,
    '  <!-- honeypot anti-spam: não remova -->',
    '  <input type="text" name="_gotcha" style="display:none" tabindex="-1" autocomplete="off">',
    ...campos.map(campoHtml),
    '  <button type="submit">Enviar</button>',
    '  <p id="leadflow-mensagem" style="display:none"></p>',
    '</form>',
  ].join('\n');
}

export function gerarCodigoCompleto(contexto) {
  return gerarHtmlFormulario(contexto) + '\n\n' + gerarScriptInterceptacao(contexto);
}

export function gerarScriptElementorPro({ apiUrl, formKey, campos }) {
  const nomeCampos = campos.filter((c) => c.tipo !== 'oculto').map((c) => `'${c.nome_campo}'`).join(', ');
  return [
    '<script>',
    '(function () {',
    `  var API = '${apiUrl}';`,
    `  var FORM_KEY = '${formKey}';`,
    `  var CAMPOS_MAPEADOS = [${nomeCampos}];`,
    blocoColetarUtms(),
    '  coletarUtms(); // persiste os UTMs já no carregamento da página',
    "  var _idem = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));",
    '',
    "  document.addEventListener('submit', function (evento) {",
    "    var form = evento.target;",
    "    if (!form.classList.contains('elementor-form')) return;",
    '',
    '    var dados = {};',
    '    var campos = form.querySelectorAll(\'[name^="form_fields["]\');',
    '    campos.forEach(function (input) {',
    '      var match = input.name.match(/^form_fields\\[(.+)\\]$/);',
    '      if (match && CAMPOS_MAPEADOS.indexOf(match[1]) !== -1) {',
    '        dados[match[1]] = input.value;',
    '      }',
    '    });',
    '    dados._utm = coletarUtms();',
    '    dados._referrer = document.referrer;',
    '    dados._pagina = window.location.href;',
    '    dados._idem = _idem;',
    '',
    '    // Envia ao LeadFlow; se configurado, redireciona após confirmação do servidor',
    "    fetch(API + '/api/captura/' + FORM_KEY, {",
    "      method: 'POST',",
    "      headers: { 'Content-Type': 'application/json' },",
    '      body: JSON.stringify(dados)',
    '    }).then(function (r) { return r.json(); })',
    '      .then(function (corpo) {',
    '        if (corpo.sucesso && corpo.redirect_url) {',
    '          window.location.href = corpo.redirect_url;',
    '        }',
    '      })',
    "      .catch(function () {}); // silencioso — não afeta a UX do Elementor",
    '  }, true); // fase de captura — dispara antes do handler do Elementor',
    '})();',
    '</script>',
  ].join('\n');
}

export function gerarScriptInterceptacao({ apiUrl, formKey, idFormulario = 'leadflow-form' }) {
  return [
    '<script>',
    '(function () {',
    `  var API = '${apiUrl}';`,
    `  var FORM_KEY = '${formKey}';`,
    blocoColetarUtms(),
    '  coletarUtms(); // persiste os UTMs já no carregamento da página',
    "  var _idem = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));",
    '',
    '  function iniciar() {',
    `    var formulario = document.getElementById('${idFormulario}');`,
    '    if (!formulario) return;',
    "    formulario.addEventListener('submit', function (evento) {",
    '      evento.preventDefault();',
    '      var dados = {};',
    '      new FormData(formulario).forEach(function (valor, chave) { dados[chave] = valor; });',
    '      dados._utm = coletarUtms();',
    '      dados._referrer = document.referrer;',
    '      dados._pagina = window.location.href;',
    '      dados._idem = _idem;',
    '',
    "      var botao = formulario.querySelector('[type=\"submit\"]');",
    '      if (botao) botao.disabled = true;',
    "      fetch(API + '/api/captura/' + FORM_KEY, {",
    "        method: 'POST',",
    "        headers: { 'Content-Type': 'application/json' },",
    '        body: JSON.stringify(dados)',
    '      })',
    '        .then(function (resposta) {',
    '          return resposta.json().then(function (corpo) { return { ok: resposta.ok, corpo: corpo }; });',
    '        })',
    '        .then(function (resultado) {',
    "          if (!resultado.ok) throw new Error(resultado.corpo.erro || 'Não foi possível enviar');",
    '          if (resultado.corpo.redirect_url) { window.location.href = resultado.corpo.redirect_url; return; }',
    '          formulario.reset();',
    "          var mensagem = document.getElementById('leadflow-mensagem');",
    '          if (mensagem) {',
    "            mensagem.textContent = resultado.corpo.mensagem || 'Recebemos seus dados. Obrigado!';",
    "            mensagem.style.display = 'block';",
    '          }',
    '        })',
    '        .catch(function (erro) { alert(erro.message); })',
    '        .finally(function () { if (botao) botao.disabled = false; });',
    '    });',
    '  }',
    "  if (document.readyState === 'loading') {",
    "    document.addEventListener('DOMContentLoaded', iniciar);",
    '  } else {',
    '    iniciar();',
    '  }',
    '})();',
    '</script>',
  ].join('\n');
}
