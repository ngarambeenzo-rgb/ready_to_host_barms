<?php
// Serve manifest.json with correct Content-Type
// InfinityFree injects HTML into .json files, breaking PWA
header('Content-Type: application/manifest+json');
header('Cache-Control: public, max-age=3600');
echo '{
  "name": "BarMS Pro — Bar Management System",
  "short_name": "BarMS Pro",
  "description": "Rwanda Bar Management System — Sales, Stock, Reports & More",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#1E3A8A",
  "theme_color": "#1E3A8A",
  "orientation": "any",
  "lang": "en",
  "categories": ["business", "finance"],
  "icons": [
    { "src": "assets/icons/icon-72.png",   "sizes": "72x72",   "type": "image/png" },
    { "src": "assets/icons/icon-96.png",   "sizes": "96x96",   "type": "image/png" },
    { "src": "assets/icons/icon-128.png",  "sizes": "128x128", "type": "image/png" },
    { "src": "assets/icons/icon-144.png",  "sizes": "144x144", "type": "image/png" },
    { "src": "assets/icons/icon-152.png",  "sizes": "152x152", "type": "image/png" },
    { "src": "assets/icons/icon-192.png",  "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "assets/icons/icon-384.png",  "sizes": "384x384", "type": "image/png" },
    { "src": "assets/icons/icon-512.png",  "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "shortcuts": [
    {
      "name": "Quick Sale",
      "short_name": "Quick Sale",
      "description": "Go directly to Quick Sale",
      "url": "./?page=quicksale",
      "icons": [{ "src": "assets/icons/icon-96.png", "sizes": "96x96" }]
    }
  ]
}';
