#!/bin/zsh

PROJECT="myrwcjurblksypvekuzb"

for fn in anon-children anon-community anon-family anon-messages anon-parent-updates
do
  echo "🚀 Déploiement de $fn..."
  supabase functions deploy $fn --project-ref $PROJECT --no-verify-jwt
done

echo "✅ Tous les anon-* ont été redéployés avec --no-verify-jwt"

