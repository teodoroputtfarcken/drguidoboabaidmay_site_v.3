# Site do Dr. Guido Boabaid May

O site público é publicado no GitHub Pages. O painel fica em `/admin` na Vercel e usa PostgreSQL no Neon.

## 1. Neon

No projeto `drguido-cms`, abra **SQL Editor** e selecione o banco da branch principal. Copie o conteúdo inteiro de `cms/neon.sql` e execute. O script cria as tabelas e cadastra as seis matérias iniciais uma única vez. Se houver publicações reais no MySQL anterior, exporte e migre esses dados antes de trocar de banco. As tabelas novas começam com o Blog vazio.

Em **Connect**, copie a URL PostgreSQL com **Connection pooling** ativado. Guarde como `DATABASE_URL`.

## 2. Vercel

Importe este repositório em um novo projeto. Use a raiz do projeto, o framework Express e Node.js 22 ou 24. Antes do deploy, configure as variáveis na Vercel:

| Variável | Valor |
|---|---|
| DATABASE_URL | URL pooled do Neon |
| BASE_URL | URL pública do GitHub Pages, incluindo o caminho do repositório, sem barra final |
| ADMIN_EMAIL | E-mail do editor |
| ADMIN_PASSWORD_HASH | Hash gerado por `npm run hash-password` |
| SESSION_SECRET | Chave aleatória gerada separadamente |
| PAGES_DEPLOY_TOKEN | Opcional durante o teste. Configure na etapa 4. |

Em uma máquina com Node.js, na raiz do projeto, execute `npm ci` e `npm run hash-password`. Escolha uma senha com pelo menos 14 caracteres. Gere o segredo de sessão com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

Teste `https://<projeto>.vercel.app/admin` com o e-mail e a senha original. Capas JPG, PNG e WEBP podem ter até 4 MB. O banco guarda as capas, as sessões e o conteúdo. O host de produção da Vercel deve permitir acesso público às rotas de conteúdo publicado para o GitHub Actions.

## 3. GitHub Pages

Antes de mudar a fonte atual do Pages, valide o painel e publique um artigo de teste. Em **Settings → Secrets and variables → Actions → Variables**, crie `PAGES_BACKEND_URL` com a URL HTTPS do projeto da Vercel, sem `/admin`.

Integre o código na branch `main`. Em **Settings → Pages → Build and deployment → Source**, selecione **GitHub Actions**. Em **Actions → Publicar site do Dr. Guido → Run workflow**, rode o fluxo para `main`. Confira a home, o Blog, a busca e o artigo no endereço do GitHub Pages. Se houver domínio próprio no Pages, configure `BASE_URL` na Vercel para esse endereço e faça um novo deploy antes de gerar as páginas novamente.

A compilação copia apenas os arquivos públicos e o conteúdo publicado. Rascunhos, sessões, credenciais e código do painel não integram o site estático.

## 4. Publicar pelo painel

No GitHub, crie um token de acesso fine-grained com acesso apenas a este repositório e permissão **Actions: Read and write**. Salve o valor em `PAGES_DEPLOY_TOKEN` nas variáveis de produção da Vercel e faça um novo deploy.

No painel, publique ou edite o conteúdo e clique em **Atualizar site público**. A atualização aparece após o GitHub Actions concluir a publicação. Use o mesmo botão depois de retirar uma matéria do ar ou excluir um artigo publicado.
