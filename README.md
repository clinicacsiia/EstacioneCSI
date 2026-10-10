# Estacionamento CSI

Sistema de estacionamento (entrada/saída, caixa, mensalistas, gerência, painel para TV) feito só com HTML/CSS/JavaScript.

- **Telas:** publicadas de graça no **GitHub Pages** (HTTPS, funciona no celular e libera a impressora Bluetooth).
- **Dados e login:** ficam no **Supabase** (banco Postgres). O login continua sendo do próprio sistema: o administrador cadastra as pessoas na tela de Administração.
- **Fotos de avarias/problemas:** tiradas pelo celular na entrada, na ficha ou na entrega; ficam no Supabase (veja *Fotos* em [`supabase/LEIA-ME.md`](supabase/LEIA-ME.md)).
- **Pagamento pelo manobrista:** o administrador pode liberar manobristas específicos para receber o pagamento na aba **Buscar** (funcionam como caixa). Veja [`supabase/LEIA-ME.md`](supabase/LEIA-ME.md).
- Nenhum computador do estacionamento precisa ficar ligado como servidor.

## Perfis

| Perfil | O que faz |
|---|---|
| **Administrador** | Cadastra usuários, redefine senhas, define permissões. |
| **Gerente** | Gerência, histórico, backup, descontos, exclusão de fotos. |
| **Caixa** | Recebe pagamentos, abre/fecha caixa, desconto, ticket perdido, sangria, nota de teste. |
| **Manobrista** | Registra entrada, busca e entrega veículos, tira fotos. Se o administrador marcar **"Pode receber pagamentos"**, também recebe na aba Buscar e fecha o próprio caixa (sem desconto, ticket perdido, sangria nem nota fiscal). |

Passo a passo completo (o que fazer no Supabase): [`supabase/LEIA-ME.md`](supabase/LEIA-ME.md).

## Estrutura

```
index.html, caixa.html, manobrista.html, gerencia.html, admin.html, painel.html   telas
css/  js/                                   estilo e lógica
js/config.js                                URL e chave PÚBLICA do Supabase (você preenche)
js/api.js                                   como o site fala com o banco
js/pagamento.js                             janela de pagamento e abrir/fechar caixa (usada pelo caixa e pelo manobrista liberado)
supabase/schema.sql                         banco + "servidor": cole no SQL Editor do Supabase
supabase/teste/                             testes do schema.sql (Postgres de verdade, sem internet)
.github/workflows/publicar.yml              publica as telas no GitHub Pages a cada push
.github/workflows/testes.yml                roda os testes do banco quando o SQL muda
```

## Segurança em uma linha

A chave `publishable` fica visível no site **de propósito** e sozinha não dá acesso a nada: as tabelas ficam num schema privado, trancadas, e a única porta de entrada é a função `estaciona_api`, que exige usuário e senha do sistema. **Nunca** coloque a chave `secret`/`service_role` no código. Nada de dados vai para o GitHub: o `.gitignore` barra backups e certificados. Antes de cada `git push`, rode `git status` e confira.
