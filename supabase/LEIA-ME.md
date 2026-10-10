# Estacionamento CSI no Supabase — passo a passo

Os dados e o login agora ficam no **Supabase** (banco Postgres). O Google Planilhas/Apps Script **não é mais usado**.

```
 Celular / PC / TV            GitHub Pages                         Supabase
 (navegador)       ───────►   telas (html, css, js)
      │
      └── login, tickets, caixa ──► função  estaciona_api  ──►  tabelas trancadas (schema "estaciona")
          (POST para a sua URL)     "o servidor"                  usuários, tickets, caixas, auditoria...
```

- **GitHub** guarda o código e publica as telas (HTTPS, libera a impressora Bluetooth).
- **Supabase** guarda tudo: usuários e senhas (só como hash), tickets, caixas, mensalistas, auditoria, configurações.
- O **login continua sendo do sistema**: o administrador cadastra as pessoas na tela de Administração. As senhas são conferidas **dentro do banco**; o navegador nunca recebe hash de senha.
- **Senha temporária:** a senha que o administrador define ao cadastrar alguém (ou em **🔑 Redefinir senha**) é temporária. No primeiro acesso a pessoa é obrigada a escolher a própria senha; até lá o banco recusa qualquer outra operação e não entrega tickets, caixas nem auditoria.

## Por que é seguro mesmo com a chave no site

A chave `sb_publishable_...` fica visível para qualquer pessoa que abrir o site (é assim que o Supabase funciona). Por isso:

- As tabelas ficam num schema **privado** (`estaciona`), com **RLS ligado** e **nenhuma permissão** para a chave pública. Com ela, ninguém lê nem grava nenhuma tabela.
- A **única** porta de entrada é a função `estaciona_api`: ela só devolve dados para quem tem uma sessão válida (usuário + senha), com limite de tentativas de senha e permissões por perfil.
- **Nunca** coloque no site (nem me envie) a chave `sb_secret_...`, a `service_role` ou a senha do banco: essas dão acesso total.

> Os testes automáticos (`supabase/teste/`) verificam isso: a chave pública é barrada em todas as tabelas, nenhum hash aparece nas respostas, e o login bloqueia após 5 erros.

---

## PARTE 1 — Criar o banco (uma vez só)

1. Abra o seu projeto no Supabase → menu da esquerda → **SQL Editor** → **New query**.
2. Abra o arquivo [`schema.sql`](schema.sql) deste repositório, **copie tudo** e **cole** no editor.
3. Clique em **Run** (ou `Ctrl+Enter`). Se aparecer um aviso pedindo confirmação, confirme (**Run this query**).
4. Na aba **Results**, no fim, aparece uma coluna **ANOTE: usuário e senha do administrador**:

   ```
   Usuário do administrador: admin
   Senha inicial: xxxxxxxxxxxx
   ```

   **Anote a senha.** Para ver de novo, rode no SQL Editor: `select estaciona.senha_admin_inicial();`
5. Pode rodar o `schema.sql` de novo quando quiser (por exemplo, depois de uma atualização): ele **não apaga dados**.

**Conferir que funcionou.** Em uma nova query, rode:

```sql
select public.estaciona_api('GET', '/api/painel', '', '{}'::jsonb);
```

Deve voltar algo como `{"s": 200, "c": {"aCaminho": [], "estabelecimento": "Estacionamento CSI", ...}}`.

## PARTE 2 — Conferir a URL e a chave no site

O arquivo [`js/config.js`](../js/config.js) já está preenchido com:

- **URL do projeto:** `https://fzrzkcqeqptgzfrchuod.supabase.co`
- **Chave publishable:** `sb_publishable_iC8R...` (a que você enviou)

Confira em Supabase → **Project Settings → API Keys** (ou *API*) se a **Project URL** e a **Publishable key** são exatamente essas. Se forem outras, troque as duas linhas no `config.js`.

## PARTE 3 — A virada (ordem importa, para não perder dados)

Faça num momento tranquilo (fora do horário de movimento).

1. **No sistema antigo (Google):** peça para todos **pararem de usar** e saírem. Entre como gerente → **Gerência → Backup → Baixar backup agora**. Guarde o arquivo `.json` (ele tem dados de clientes: **não suba para o GitHub**).
   - Se o sistema antigo já não abrir, use o último `diario-AAAA-MM-DD.json` da pasta **EstacionaMais - backups** do Google Drive: tem o mesmo formato.
2. Faça o **merge** desta alteração na branch `main` do GitHub. Em 1–2 minutos o GitHub Pages publica o site novo (aba **Actions**).
3. **Feche e abra de novo** o site em todos os aparelhos (ou recarregue com força), para sair da versão antiga que o navegador guardou.
4. Entre com **admin** e a senha da Parte 1. Você cai na tela de Administração.
5. **Importar os dados antigos:**
   1. Em Administração, cadastre um usuário **temporário** com perfil **Gerente** (ex.: `temp`).
   2. Saia e entre com `temp` → **Gerência → Backup → Restaurar de um arquivo** → escolha o `.json` do passo 1 → digite `RESTAURAR`.
   3. Pronto: tickets, caixas, mensalistas, auditoria, configurações **e os usuários com as senhas de sempre** voltam. O usuário `temp` desaparece (a restauração troca tudo).
   4. Saia e entre com o seu usuário de sempre. O `admin` também volta com a **senha antiga dele**.
6. Teste um fluxo completo: registrar uma entrada (Manobrista), receber o pagamento (Caixa), buscar e entregar. Abra o `painel.html` numa TV/aba: só números de ticket.
7. Só depois de tudo certo, **desligue o Google** (Parte 5).

> Se não há dados para trazer (começando do zero), pule o passo 5 e cadastre as pessoas direto na tela de Administração.

## PARTE 4 — Ajustes recomendados no Supabase

- **Backups: o plano gratuito NÃO faz cópia automática.** No Supabase, *Database → Backups* só tem cópias diárias nos planos pagos (Pro). No plano gratuito, **baixe um backup todo dia** (Gerência → Backup → Baixar backup agora) e guarde fora do computador do estacionamento (pendrive, outro e-mail). O banco também guarda internamente as 5 últimas cópias tiradas *antes* de restaurar/apagar tudo (tabela `estaciona.copias`).
- **Projeto pausado.** No plano gratuito o Supabase **pausa o projeto após 7 dias sem uso**. Se isso acontecer, o site mostra *"Não foi possível falar com o servidor"*; entre no painel do Supabase e clique em **Restore project**. Num estacionamento que abre todo dia isso não deve ocorrer, mas considere o plano Pro se o sistema for crítico.
- **Senha do admin esquecida:** no SQL Editor rode `select estaciona.redefinir_senha_admin();` (mostra uma senha nova; quem estava logado como admin precisa entrar de novo).
- **Ver erros do servidor:** Supabase → **Logs → Postgres Logs** (procure por `estaciona_api`).

## PARTE 5 — Desligar o Google (depois de tudo funcionando)

1. Google Apps Script do estacionamento → **Implantar → Gerenciar implantações** → arquive a implantação ativa. Em **Gatilhos**, apague o `backupDiario`.
2. Mantenha a planilha **restrita** por alguns dias, como segurança; depois pode apagá-la (e a pasta *EstacionaMais - backups* do Drive, se não precisar mais).
3. O código antigo continua no histórico do GitHub (commits anteriores), se algum dia precisar consultar.

---

## Fotos de avarias e problemas

**Para ligar (uma vez):** depois de publicar esta versão no GitHub, rode o [`schema.sql`](schema.sql) **de novo** no SQL Editor (Parte 1, passo 5 — não apaga dados). Sem isso o sistema continua funcionando e o ticket sai normalmente, mas as fotos não sobem (a tela mostra *"Ocorreu um erro."* e o console do navegador diz *"rode o supabase/schema.sql de novo"*).

**Como se usa**

- **Entrada (manobrista):** em *Estado do veículo*, toque em **📷 Tirar foto** (abre a câmera) ou **🖼️ Galeria**. Dá para tirar várias; o **✕** remove antes de imprimir. Ao tocar em *IMPRIMIR TICKET* o ticket sai na hora e as fotos sobem logo em seguida. Se não houver sinal, aparece um aviso amarelo com **Tentar de novo** (as fotos ficam na memória do aparelho: não feche a página).
- **Depois, a qualquer momento:** abra a **Ficha** do veículo (toque no carro na lista) → *Fotos de avarias ou problemas*. Na hora da **entrega**, o botão **📷 Fotos / problema** abre as fotos e permite tirar novas (útil quando o cliente aponta um problema ali).
- **Quem vê:** manobrista, atendente e gerente veem o selo **📷 N** nas listas e as fotos na Ficha; o gerente também as vê no **Histórico** (com data, hora e quem tirou). O painel da TV nunca mostra fotos.
- **Quem apaga:** só o **gerente** (no visor, *Excluir esta foto*), para ninguém remover prova de avaria. Fica na auditoria (*Foto adicionada* / *Foto excluída*).
- **Permissão:** em *Administração → Permissões*, a linha *Anexar fotos de avarias / problemas* liga ou desliga para manobrista e atendente.

**Como funciona por dentro:** cada foto é **reduzida no celular** antes de subir (JPEG de até 1024 px, ~60–100 KB, mais uma miniatura de ~10 KB) e guardada na tabela `estaciona.fotos`. O ticket guarda só os *ids* das fotos (campo `fotos`), por isso as listas continuam leves. Máximo de **10 fotos por veículo**.

**Espaço (leia):** o plano gratuito do Supabase tem **500 MB para o banco inteiro**. Para as fotos não encherem o banco (o Supabase o deixa somente-leitura e as entradas parariam), o sistema reserva **250 MB** para elas (~2.500 fotos): quando acaba, recusa foto nova com o aviso *"O espaço reservado para fotos acabou. Avise o gerente."*. No SQL Editor:

```sql
-- quanto espaço as fotos usam
select count(*) as fotos, pg_size_pretty(coalesce(sum(bytes), 0)::bigint) as espaco from estaciona.fotos;

-- libera espaço: apaga fotos com mais de 90 dias de veículos que já saíram (quem está no pátio nunca perde foto)
select estaciona.apagar_fotos_antigas(90);
```

Para mudar o limite, edite o número em `limite_fotos_bytes()` no `schema.sql` e rode de novo.

**Backup:** o arquivo de backup guarda só a *lista* de fotos de cada ticket, **não as imagens** — elas existem apenas no banco do Supabase (e o plano gratuito não tem backup automático). *Restaurar* um backup **não apaga** fotos (os tickets do backup voltam a apontar para elas); *Apagar tudo e recomeçar* **apaga** as fotos também.

**Privacidade:** as fotos podem mostrar pessoas, documentos ou objetos de valor no carro. Oriente a equipe a fotografar só a avaria/problema.

---

## Entrada do manobrista

- **Modelo e cor são obrigatórios** para imprimir o ticket (as cores aparecem na ordem das mais vendidas no Brasil).
- **Placa já conhecida:** ao digitar uma placa que já passou pelo estacionamento, o formulário preenche os dados da última visita.

## Manobrista que recebe pagamentos

**Não precisa rodar o `schema.sql` de novo** (é só mudança nas telas; a permissão fica gravada no cadastro do usuário).

- **Liberar:** *Administração → Usuários → Editar* (ou ao cadastrar) um usuário de perfil **Manobrista** → marque **"Pode receber pagamentos"**. Na lista aparece o selo **💵 recebe**. A opção só existe para o perfil Manobrista.
- **Como o manobrista usa:** aba **Buscar** → bloco **Receber e buscar** → digita a placa ou o ticket → **RECEBER** (dinheiro, PIX, débito ou crédito, com troco). Se não houver caixa aberto, o sistema pede o fundo de troco e abre na hora. No fim, o botão **🔑 Buscar agora** já manda buscar o carro. Em **Fechamento → Meu caixa** ele vê o que recebeu e **fecha o caixa no fim do turno**.
- **Continua só com caixa/gerente:** desconto, ticket perdido, sangria e nota fiscal.
- **Auditoria:** liberar ou retirar a permissão fica registrado (*Usuário criado/alterado*).
- **Atenção:** essa regra é aplicada pelas telas (como as demais permissões de ticket e caixa). O servidor só barra por conta própria usuários, configurações, fotos e nota fiscal. Por isso libere só manobristas de confiança.

## Conferir se o banco está atualizado

Em **SQL Editor** (ou me peça para conferir pelo conector do Supabase). O esperado hoje é **11 tabelas** no schema `estaciona`, todas com RLS ligado:

```sql
select c.relname as tabela, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'estaciona' and c.relkind = 'r' order by 1;
-- esperado: controle, copias, deltas, fotos, notas, objetos, propriedades, registros, segredos, sessoes, tentativas

select public.estaciona_api('GET', '/api/painel', '', '{}'::jsonb);   -- deve voltar "s": 200
```

Regra prática: **só é preciso rodar o `schema.sql` de novo quando o commit mexer em `supabase/schema.sql`** (`git log -- supabase/schema.sql`). Mudanças só em `html`, `css` e `js` entram sozinhas com o merge na `main`. Última conferência: 10/10/2026, banco e `schema.sql` em sincronia (11 tabelas, 73 funções, API respondendo 200).

---

## O que mudou para quem usa

- **Mais rápido:** o esperado é cada gravação levar de 0,15 a 0,3 s (no Google eram ~2 s). Numa simulação com 150 ms por chamada, registrar uma entrada levou ~0,7 s (antes ~6 s). O tempo real depende da sua internet e da distância até o servidor do Supabase (o seu projeto está no Canadá). As telas atualizam sozinhas a cada ~3 s.
- Telas, perfis, permissões, auditoria, nota fiscal de teste, backup e restauração: **iguais**.
- **Sem internet, sem sistema** (como antes). Tenha um plano de papel para essa hora.

## Limites (leia)

- Plano gratuito: sem backup automático e com pausa por inatividade (veja a Parte 4).
- Volume: o sistema carrega os tickets em cada tela. Testado com 5.000 tickets (restaurar e ler tudo em menos de 1 s num Postgres de teste). Com muitos milhares a mais, comece um projeto novo por ano e guarde o antigo.
- Nota fiscal: só a nota de **teste** (sem valor fiscal), como antes.
- Login: vale por aba do navegador (fechar a aba encerra) e por até 12 h sem uso. Após 5 senhas erradas na mesma conta, bloqueia por 30 s (dobrando a cada bloqueio, até 15 min).

## Problemas comuns

Quando o sistema falha, a tela mostra só **"Ocorreu um erro."** (sem explicações para quem está trabalhando). O detalhe técnico fica no **console do navegador** (F12 → *Console*, linhas que começam com `[Estacionamento]`) e, no servidor, em *Logs → Postgres Logs* no Supabase.

| Sintoma | Causa provável |
|---|---|
| "Ocorreu um erro." ao abrir o sistema ou ao salvar | Sem internet; projeto pausado (Restore project); URL/chave erradas em `js/config.js` (ou chave revogada); o `schema.sql` ainda não foi executado; ou erro no servidor (veja o console do navegador e *Logs → Postgres Logs*). |
| Volta ao login sozinho | Passou 12 h sem uso, senha trocada ou redefinida pelo administrador, usuário desativado, ou restauração/apagar tudo. |
| "Muitas tentativas. Aguarde…" | Bloqueio por senha errada (por conta). Aguarde. |
| Restaurar backup grande dá erro de tempo | Rode `alter role anon set statement_timeout = '60s';` no SQL Editor (o `schema.sql` já faz isso, mas o Supabase pode ter restaurado o padrão de 3 s). |
| Site do GitHub abre em branco / 404 | O fluxo da aba **Actions** ainda não terminou, ou *Settings → Pages → Source* não está em **GitHub Actions**. |

---

## Testes automáticos

`supabase/teste/` roda o `schema.sql` num Postgres de verdade (PGlite, em WebAssembly) — **sem internet e sem tocar no seu projeto**:

```bash
cd supabase/teste
npm install
npm test
```

São 31 testes: segurança (a chave pública é barrada), login e sessões, permissões, versões e conflitos, usuários e senhas (inclusive a troca da senha temporária), auditoria, painel, nota fiscal, backup/restaurar/zerar, fotos de avarias (formato, limites, permissões, limpeza) e desempenho. O GitHub os roda sozinho quando o SQL muda (aba **Actions → Testes do banco**).
O que os testes **não** cobrem: a rede entre o seu navegador e o Supabase (CORS, pausa do projeto, limites do plano). Por isso, na Parte 3, faça o teste de um fluxo completo.
