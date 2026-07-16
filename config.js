/* ============ CONFIGURATION SUPABASE ============
   Remplace les deux valeurs ci-dessous par celles de ton projet Supabase.
   Tu les trouves dans : Project Settings → API
     - Project URL          → SUPABASE_URL
     - anon / public key    → SUPABASE_ANON_KEY

   ⚠ L'anon key est PUBLIQUE par conception (elle finit dans le JS envoyé
   au navigateur, donc visible par n'importe qui). Ce n'est pas un secret :
   la vraie sécurité vient des policies RLS (Row Level Security) définies
   dans schema.sql, qui garantissent que chaque utilisateur ne peut lire/
   écrire QUE sa propre ligne dans la table user_data.
   Ne mets JAMAIS ta "service_role key" ici — celle-là est un vrai secret,
   elle ne doit jamais apparaître côté navigateur. */

window.SUPABASE_URL = "https://ngsjsgccpcwdimkxjhby.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_Gh7MTmPedARG5UQZmUPmeQ_BXY1DyN2";
