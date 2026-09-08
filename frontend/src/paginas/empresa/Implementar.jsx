import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, urlPublicaDaApi } from '../../lib/api.js';
import { BlocoCodigo, CabecalhoPagina, Carregando, avisar } from '../../componentes/ui.jsx';
import { gerarCodigoCompleto, gerarScriptElementorPro, gerarSnippetReact } from '../../lib/embeds.js';
import { useRevelar } from '../../lib/animacoes.js';

const PLATAFORMAS = [
  { id: 'react', nome: 'React / Código puro' },
  { id: 'wordpress', nome: 'WordPress' },
  { id: 'greatpages', nome: 'GreatPages' },
];

export default function Implementar() {
  const { id } = useParams();
  const [formulario, setFormulario] = useState(null);
  const [plataforma, setPlataforma] = useState('react');
  const ref = useRevelar([formulario !== null, plataforma]);

  useEffect(() => {
    api(`/api/empresa/formularios/${id}`)
      .then((dados) => setFormulario(dados.formulario))
      .catch((erro) => avisar(erro.message, 'erro'));
  }, [id]);

  if (!formulario) return <Carregando />;

  const contexto = { apiUrl: urlPublicaDaApi(), formKey: formulario.form_key, campos: formulario.campos };

  return (
    <div ref={ref}>
      <CabecalhoPagina
        etiqueta={
          <Link to="/painel/formularios" className="hover:text-osso-suave">← formulários</Link>
        }
        titulo={`Implementar "${formulario.nome}"`}
        descricao="Escolha a plataforma e siga o passo a passo. O código já captura UTMs automaticamente — sem campos ocultos manuais."
      />

      {/* Seletor de plataforma */}
      <div className="flex gap-2 mb-8" data-revelar>
        {PLATAFORMAS.map((item) => (
          <button
            key={item.id}
            onClick={() => setPlataforma(item.id)}
            className={`rounded-campo px-4 py-2 text-sm border transition-all duration-200 ${
              plataforma === item.id
                ? 'bg-bronze text-grafite-950 border-bronze font-medium'
                : 'bg-vidro border-linha text-osso-suave hover:border-linha-forte'
            }`}
          >
            {item.nome}
          </button>
        ))}
      </div>

      <div className="cartao p-4 mb-8 text-xs text-osso-suave space-y-1" data-revelar>
        <p>
          <span className="text-osso-mudo">Chave do formulário:</span>{' '}
          <code className="text-bronze-claro">{formulario.form_key}</code>
        </p>
        <p className="text-osso-mudo">
          ⚠️ Lembre-se de cadastrar o domínio do site em <Link to="/painel/dominios" className="text-bronze hover:text-bronze-claro">Domínios</Link> — sem isso o navegador bloqueia o envio (CORS).
        </p>
      </div>

      {plataforma === 'react' && <GuiaReact contexto={contexto} />}
      {plataforma === 'wordpress' && <GuiaWordpress contexto={contexto} />}
      {plataforma === 'greatpages' && <GuiaGreatPages contexto={contexto} />}
    </div>
  );
}

function Passo({ numero, titulo, children }) {
  return (
    <section className="grid grid-cols-[44px_1fr] gap-4" data-revelar>
      <span className="font-editorial text-2xl text-bronze/70 pt-0.5">{String(numero).padStart(2, '0')}</span>
      <div className="space-y-3 min-w-0">
        <h3 className="font-editorial text-lg">{titulo}</h3>
        {children}
      </div>
    </section>
  );
}

function GuiaReact({ contexto }) {
  return (
    <div className="space-y-10">
      <Passo numero={1} titulo="Copie o componente para o seu projeto">
        <p className="text-sm text-osso-suave">
          Salve como <code className="text-bronze-claro">FormularioLeadFlow.jsx</code>. Ele já envia via{' '}
          <code className="text-bronze-claro">fetch</code>, captura UTMs da URL (persistindo em sessionStorage) e inclui o honeypot anti-spam.
        </p>
        <BlocoCodigo codigo={gerarSnippetReact(contexto)} />
      </Passo>
      <Passo numero={2} titulo="Use o componente onde quiser">
        <BlocoCodigo codigo={`import FormularioLeadFlow from './FormularioLeadFlow';\n\n<FormularioLeadFlow />`} />
        <p className="text-sm text-osso-mudo">
          O estilo é seu: aplique as classes do seu design system nos elementos do formulário.
        </p>
      </Passo>
    </div>
  );
}

function GuiaWordpress({ contexto }) {
  const camposVisiveis = contexto.campos.filter((c) => c.tipo !== 'oculto');
  return (
    <div className="space-y-10">
      <Passo numero={1} titulo="Defina o ID de cada campo no Elementor">
        <p className="text-sm text-osso-suave">
          No widget <strong>Form</strong> do Elementor Pro, clique em cada campo → aba <strong>Avançado</strong> → campo <strong>ID</strong> e cole o valor da coluna direita:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-linha text-left text-osso-mudo">
                <th className="py-2 pr-6 font-medium">Rótulo do campo</th>
                <th className="py-2 font-medium">ID a definir no Elementor</th>
              </tr>
            </thead>
            <tbody>
              {camposVisiveis.map((campo) => (
                <tr key={campo.nome_campo} className="border-b border-linha/50">
                  <td className="py-2 pr-6 text-osso-suave">{campo.rotulo}</td>
                  <td className="py-2">
                    <code className="text-bronze-claro bg-grafite-800 px-2 py-0.5 rounded text-xs">{campo.nome_campo}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-osso-mudo">
          Campos do tipo "oculto" não precisam de ID — são ignorados pelo script.
        </p>
      </Passo>

      <Passo numero={2} titulo="Adicione o script via widget HTML">
        <p className="text-sm text-osso-suave">
          Ainda no Elementor, arraste um widget <strong>HTML</strong> para a página (pode ser logo abaixo do formulário ou em qualquer posição), cole o script abaixo e clique em <strong>Atualizar</strong>:
        </p>
        <BlocoCodigo codigo={gerarScriptElementorPro(contexto)} />
        <p className="text-sm text-osso-mudo">
          O script captura o envio do formulário do Elementor e envia o lead — incluindo UTMs — ao LeadFlow. O Elementor continua funcionando normalmente (e-mails, integrações dele, etc.).
        </p>
      </Passo>

      <Passo numero={3} titulo="Publique e teste">
        <p className="text-sm text-osso-suave">
          Acesse a página publicada com <code className="text-bronze-claro">?utm_source=teste</code> na URL, envie o formulário
          e confirme o lead (com a origem registrada) na aba <Link to="/painel/leads" className="text-bronze hover:text-bronze-claro">Leads</Link>.
        </p>
      </Passo>
    </div>
  );
}

function GuiaGreatPages({ contexto }) {
  return (
    <div className="space-y-10">
      <Passo numero={1} titulo="Cole o código no elemento HTML">
        <p className="text-sm text-osso-suave">
          No editor do GreatPages, arraste um elemento <strong>HTML</strong> para a seção desejada e cole o código abaixo:
        </p>
        <BlocoCodigo codigo={gerarCodigoCompleto(contexto)} />
        <p className="text-sm text-osso-mudo">
          O código já inclui o formulário e o script de envio juntos. Cada página pode ter o seu próprio código com formulário independente.
        </p>
      </Passo>

      <Passo numero={2} titulo="Publique e teste">
        <p className="text-sm text-osso-suave">
          Acesse a página publicada com <code className="text-bronze-claro">?utm_source=teste</code> na URL, envie o formulário
          e confira o lead (com a origem registrada) na aba <Link to="/painel/leads" className="text-bronze hover:text-bronze-claro">Leads</Link>.
        </p>
      </Passo>
    </div>
  );
}
