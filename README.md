# SkillTracker (Suivi de compétences) — déploiement Netlify + Supabase

## 1. Créer le projet Supabase

1. [supabase.com](https://supabase.com) → New project (nom, mot de passe DB, région — Europe si tu veux la latence la plus faible depuis la Côte d'Ivoire).
2. Une fois le projet créé : **SQL Editor** → New query → colle tout le contenu de `schema.sql` → **Run**.
   Ça crée la table `user_data` + les policies RLS (chaque utilisateur ne voit que ses propres données).
3. **Authentication → Providers → Email** : activé par défaut. Si tu veux que les comptes soient utilisables immédiatement sans clic de confirmation par email (pratique en phase de test), décoche **"Confirm email"**. Sinon laisse activé pour un vrai lancement public.
4. **Authentication → URL Configuration → Redirect URLs** : ajoute l'URL de ton site Netlify (ex: `https://ton-site.netlify.app`). **Obligatoire** pour que le lien "mot de passe oublié" fonctionne — sans ça, Supabase refuse de rediriger vers ton site après le clic sur le lien reçu par email.
5. **Project Settings → API** : note les deux valeurs :
   - `Project URL`
   - `anon` `public` key

## 2. Configurer le front

Ouvre `config.js` et remplace :
```js
window.SUPABASE_URL = "https://TON-PROJET.supabase.co";
window.SUPABASE_ANON_KEY = "TA_CLE_ANON_PUBLIQUE";
```
par tes vraies valeurs. C'est le seul fichier à modifier avant déploiement.

⚠ L'anon key est publique par conception (visible dans le JS envoyé au navigateur) — ce n'est pas un secret, la sécurité vient des policies RLS. Ne mets jamais la `service_role key` ici.

## 3. Déployer sur Netlify

**Option A — drag & drop (le plus rapide) :**
Sur [app.netlify.com](https://app.netlify.com), glisse le dossier entier (`index.html`, `style.css`, `script.js`, `config.js`) dans la zone de déploiement manuel. Terminé.

**Option B — via Git (recommandé pour les mises à jour) :**
```bash
git init
git add .
git commit -m "init progression"
git remote add origin <ton-repo>
git push -u origin main
```
Puis sur Netlify : **Add new site → Import an existing project** → connecte le repo. Pas de build command nécessaire (site statique) : laisse "Build command" vide et "Publish directory" à `.` (racine).

## 4. Vérifier

- Ouvre le site → tu dois voir l'écran de connexion/inscription.
- Crée un compte → si "Confirm email" est activé, vérifie ta boîte mail avant de te connecter.
- Une fois connecté, crée une compétence → vérifie dans Supabase (**Table Editor → user_data**) qu'une ligne apparaît avec ton `user_id` et le JSON de tes données.

## Fichiers du projet

| Fichier | Rôle |
|---|---|
| `index.html` | Structure, charge Supabase JS + config + script |
| `style.css` | Tous les styles |
| `script.js` | Logique de l'app (auth, compétences, sous-tâches, journal...) |
| `config.js` | Tes identifiants Supabase (URL + anon key) |
| `schema.sql` | SQL à lancer une fois dans Supabase (table + RLS) |
