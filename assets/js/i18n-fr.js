/* ═══════════════════════════════════════════════════
   BARMS PRO — i18n-fr.js
   Full French for the whole interface.
   When French is on, every text BarMS shows (pages, tables,
   buttons, forms, placeholders, tooltips, windows, messages —
   including text added later) is translated from this
   dictionary. Switching back to English restores the
   original text exactly. Product names and records are data
   and are not in the dictionary, so they are left as typed.
   Lookups ignore letter case and surrounding marks
   (+ ✓ ✕ ← * : …), so one entry covers "Save", "SAVE", "Save *".
   Kinyarwanda labels are kept as they are.
═══════════════════════════════════════════════════ */

const FR_DICT = {
  // ── general ──
  "Add": "Ajouter", "Edit": "Modifier", "Delete": "Supprimer", "Remove": "Retirer", "Save": "Enregistrer", "Cancel": "Annuler",
  "Close": "Fermer", "Confirm": "Confirmer", "Back": "Retour", "Done": "Terminé", "Yes": "Oui", "No": "Non", "OK": "OK",
  "Apply": "Appliquer", "Refresh": "Actualiser", "Search": "Rechercher", "Search…": "Rechercher…", "Filter": "Filtrer", "Print": "Imprimer",
  "Loading…": "Chargement…", "Loading": "Chargement", "Details": "Détails", "Status": "Statut", "Action": "Action", "Actions": "Actions",
  "Active": "Actif", "Inactive": "Inactif", "All": "Tous", "Other": "Autre", "Others": "Autres", "None": "Aucun", "— None —": "— Aucun —",
  "Name": "Nom", "Date": "Date", "Time": "Heure", "Date & Time": "Date et heure", "Type": "Type", "Category": "Catégorie", "Description": "Description",
  "Note": "Note", "Note / Reason": "Note / Motif", "Reason": "Motif", "Reason (required)": "Motif (obligatoire)", "Reason:": "Motif :",
  "Amount": "Montant", "Amount (RWF)": "Montant (RWF)", "Total": "Total", "Subtotal": "Sous-total", "Price": "Prix", "Quantity": "Quantité", "Qty": "Qté",
  "Unit": "Unité", "Value": "Valeur", "Cost": "Coût", "Margin": "Marge", "Profit": "Bénéfice", "Revenue": "Revenu", "Level": "Niveau",
  "Phone": "Téléphone", "Phone (optional)": "Téléphone (facultatif)", "Phone Number (optional)": "Numéro de téléphone (facultatif)",
  "User": "Utilisateur", "Users": "Utilisateurs", "Role": "Rôle", "Password": "Mot de passe", "Username": "Nom d'utilisateur",
  "Position": "Poste", "Account": "Compte", "Device": "Appareil", "Language": "Langue", "Security": "Sécurité", "System": "Système",
  "Today": "Aujourd'hui", "Yesterday": "Hier", "This week": "Cette semaine", "Last week": "Semaine dernière", "This month": "Ce mois-ci",
  "Last month": "Mois dernier", "This Week": "Cette semaine", "This Month": "Ce mois-ci", "All time": "Depuis le début", "Custom…": "Personnalisé…",
  "Daily": "Journalier", "Weekly": "Hebdomadaire", "Monthly": "Mensuel", "Every day": "Chaque jour", "Days": "Jours",
  "Jan": "Janv", "Feb": "Févr", "Mar": "Mars", "Apr": "Avr", "May": "Mai", "Jun": "Juin", "Jul": "Juil", "Aug": "Août", "Sep": "Sept", "Oct": "Oct", "Nov": "Nov", "Dec": "Déc",
  "Pick a day": "Choisir un jour", "Pick Date": "Choisir une date", "Switch to Date": "Choisir une date", "Must be a past date": "Doit être une date passée",
  "Open": "Ouvert", "Closed": "Fermé", "Pending": "En attente", "Approved": "Approuvé", "Rejected": "Rejeté", "Resolved": "Résolu", "Dismissed": "Écarté",
  "Under review": "En cours d'examen", "Open & under review": "Ouverts et en examen", "Dismiss": "Écarter", "Check": "Vérifier", "Checks for this period": "Contrôles pour cette période",
  "Yes, remove": "Oui, retirer", "Optional description": "Description facultative", "More": "Plus", "Steps": "Étapes",
  "Previous period": "Période précédente", "This period": "Cette période", "vs previous period": "vs période précédente",
  "This period compared with the previous one": "Cette période comparée à la précédente", "Result": "Résultat", "Problem": "Problème",
  "Figure": "Chiffre", "What": "Quoi", "By": "Par", "by": "par", "then": "puis", "late": "en retard", "high": "élevé", "medium": "moyen", "Low": "Bas",
  "Highest": "Le plus élevé", "Cheapest": "Le moins cher", "Average": "Moyenne", "Minimum": "Minimum", "Left": "Restant", "Used": "Utilisé", "In": "Entrée", "Out": "Sortie",
  "In / out": "Entrées / sorties", "Net": "Net", "Expected": "Attendu", "Counted": "Compté", "Difference": "Différence", "Differences": "Écarts",
  "Not recorded": "Non enregistré", "Not checked": "Non vérifié", "Nothing in this period": "Rien sur cette période", "Older records": "Anciens enregistrements",
  "Press": "Appuyez sur", "Tap": "Touchez", "Enter": "Entrée", "Install": "Installer", "Language ": "Langue",

  "Area": "Zone", "Bill": "Addition", "% of bill": "% de l'addition", "Change": "Changer", "Cost of use": "Coût d'utilisation", "Cost / Unit": "Coût / unité", "Cost/Unit": "Coût/unité",
  "Expense records": "Dépenses enregistrées", "Food": "Plats", "Given by": "Donné par", "History": "Historique", "Item / Ingredient": "Article / ingrédient",
  "Kitchen ingredients": "Ingrédients cuisine", "Bar ingredients": "Ingrédients bar", "Bar items": "Articles bar", "Min Stock": "Stock min.",
  "No kitchen ingredients recorded yet.": "Aucun ingrédient cuisine enregistré.", "No purchase cost": "Sans coût d'achat",
  "No voids approved in this period": "Aucune annulation approuvée sur cette période", "Profit from sales": "Bénéfice des ventes", "Purchase": "Achat",
  "Purchase Cost": "Coût d'achat", "See stock": "Voir le stock", "Sold as:": "Vendu comme :", "Send Receipt": "Envoyer le reçu", "Send SMS": "Envoyer un SMS",
  "Send WhatsApp": "Envoyer sur WhatsApp", "Show sales by": "Afficher les ventes par", "Suppliers paid on delivery": "Fournisseurs payés à la livraison",
  "Enter the quantity and price to see the total.": "Saisissez la quantité et le prix pour voir le total.", "ml, pcs, bottle, g…": "ml, pcs, bouteille, g…", "liters": "litres",
  "received": "reçu", "Share": "Partager", "Confirm Payment": "Confirmer le paiement", "Done — Close": "Terminé — fermer", "Sale": "Vente", "Selling price": "Prix de vente",
  "Ingredient": "Ingrédient", "Orders": "Commandes", "Synced": "Synchronisé", "Daily sales": "Ventes par jour",
  "e.g. Drink was flat, customer complained": "ex. Boisson éventée, le client s'est plaint", "e.g. Forgot to record yesterday's evening sales": "ex. Oubli des ventes d'hier soir",
  "e.g. John Doe": "ex. Jean Dupont", "e.g. Rum, Mint, Beer bottle": "ex. Rhum, menthe, bouteille de bière", "e.g. Weekly delivery": "ex. Livraison hebdomadaire",
  "open shifts from the top bar": "ouvrez les services depuis la barre du haut", "of data locally.": "de données en local.",
  "Bar ingredients: stock count never done": "Ingrédients bar : inventaire jamais fait",

  "All Categories": "Toutes les catégories", "All staff": "Tout le personnel", "How money came in": "Comment l'argent est entré", "BarMS says": "BarMS indique",
  "Share ↑": "Partager ↑", "Costs use the average purchase price of each ingredient.": "Les coûts utilisent le prix d'achat moyen de chaque ingrédient.",

  // requests
  "Requests": "Demandes", "Refunds and voids sent by staff, waiting for someone allowed to approve them": "Remboursements et annulations envoyés par le personnel, en attente d'une personne autorisée à les approuver",
  "Refund requests": "Demandes de remboursement", "A customer paid and is getting money back. Approving pays the refund and puts sealed drinks back in stock.": "Un client a payé et est remboursé. Approuver paie le remboursement et remet les boissons scellées en stock.",
  "Order and items": "Commande et articles", "Paid back by": "Remboursé par", "Void requests": "Demandes d'annulation", "Voids": "Annulations",
  "A sale entered by mistake. Approving cancels it and reverses stock.": "Une vente saisie par erreur. Approuver l'annule et rétablit le stock.",
  "Expense void requests": "Demandes d'annulation de dépense", "No refund requests": "Aucune demande de remboursement", "No void requests": "Aucune demande d'annulation",
  "No expense void requests": "Aucune demande d'annulation de dépense", "Approve this request?": "Approuver cette demande ?", "Reject this request?": "Refuser cette demande ?",
  "Request approved": "Demande approuvée", "Request sent — it waits in Requests until the Owner approves it": "Demande envoyée — elle attend dans Demandes jusqu'à l'approbation du propriétaire",
  "The Owner changed your access": "Le propriétaire a modifié vos accès",
  // discounts
  "Discounts": "Remises", "Choose the items that get a discount and how much. Staff cannot type their own discount — at payment they can only tick the discounts you set here, and only if you allow them below.": "Choisissez les articles remisés et le montant. Le personnel ne peut pas saisir sa propre remise — au paiement il coche seulement les remises définies ici, et seulement si vous l'autorisez ci-dessous.",
  "e.g. Happy hour Primus": "ex. Happy hour Primus", "Choose an item…": "Choisir un article…", "% off": "% de remise", "RWF off each": "RWF de remise par unité",
  "Add discount": "Ajouter la remise", "Bartenders may apply these discounts": "Les barmans peuvent appliquer ces remises",
  "Managers use the \"Give Discounts\" permission below.": "Les gérants utilisent l'autorisation « Appliquer les remises » ci-dessous.",
  "No discounts yet": "Pas encore de remises", "Add one above — for example 10% off one drink during happy hour.": "Ajoutez-en une ci-dessus — par exemple 10 % sur une boisson pendant l'happy hour.",
  "Discount added": "Remise ajoutée", "Discount deleted": "Remise supprimée", "Delete this discount?": "Supprimer cette remise ?", "On": "Activée", "Off": "Désactivée",
  "Give the discount a name and choose the item": "Donnez un nom à la remise et choisissez l'article", "Enter how much the discount is": "Indiquez le montant de la remise",
  "Bartenders can now apply your discounts": "Les barmans peuvent maintenant appliquer vos remises", "Bartenders can no longer apply discounts": "Les barmans ne peuvent plus appliquer de remises",
  "set by the Owner": "définie par le propriétaire", "you are the Owner": "vous êtes le propriétaire", "Other discount": "Autre remise", "— Owner only ": "— propriétaire seulement",
  "No discount is set up for the items on this order.": "Aucune remise n'est prévue pour les articles de cette commande.",
  "Apply Discounts": "Appliquer les remises", "Tick the discounts the Owner set up (Settings → Discounts) at payment — never their own amount": "Cocher au paiement les remises définies par le propriétaire (Paramètres → Remises) — jamais leur propre montant",
  "You are not allowed to apply discounts. Ask the Owner.": "Vous n'êtes pas autorisé à appliquer des remises. Demandez au propriétaire.",
  "Only the Owner can give a discount that is not set up in Settings → Discounts": "Seul le propriétaire peut accorder une remise non prévue dans Paramètres → Remises",
  // support
  "Help & support": "Aide et assistance", "Write to the IMS team about any problem or question. We reply by phone or email.": "Écrivez à l'équipe IMS pour tout problème ou question. Nous répondons par téléphone ou e-mail.",
  "New message": "Nouveau message", "What is it about?": "De quoi s'agit-il ?", "Something is not working": "Quelque chose ne fonctionne pas", "Question": "Question",
  "Licence or payment": "Licence ou paiement", "Idea / new feature": "Idée / nouvelle fonction", "Subject": "Objet", "e.g. Receipt does not print": "ex. Le reçu ne s'imprime pas",
  "Describe the issue": "Décrivez le problème", "What happened, on which page, and what you expected. The more detail, the faster we can help.": "Ce qui s'est passé, sur quelle page, et ce que vous attendiez. Plus il y a de détails, plus vite nous pouvons aider.",
  "How can we reach you?": "Comment vous joindre ?", "Phone number or email": "Numéro de téléphone ou e-mail",
  "Your bar name, your name and the time are added automatically so we know who is writing.": "Le nom du bar, votre nom et l'heure sont ajoutés automatiquement pour que nous sachions qui écrit.",
  "Send to IMS": "Envoyer à IMS", "Your messages": "Vos messages", "Delivered to IMS": "Remis à IMS", "Not delivered": "Non remis", "Sending": "Envoi",
  "Send again": "Renvoyer", "No messages yet": "Pas encore de messages", "Messages you send to IMS appear here with their delivery status.": "Les messages envoyés à IMS apparaissent ici avec leur statut d'envoi.",
  "Message sent to IMS — we will get back to you": "Message envoyé à IMS — nous vous recontacterons", "Write a short subject": "Écrivez un objet court",
  "Describe the issue in at least a sentence": "Décrivez le problème en au moins une phrase", "Message delivered to IMS": "Message remis à IMS",
  "Email to IMS is not set up on this server yet, so messages are saved here but not delivered. Ask IMS to finish the setup (config/mail.php).": "L'envoi d'e-mails à IMS n'est pas encore configuré sur ce serveur : les messages sont enregistrés ici mais pas envoyés. Demandez à IMS de terminer la configuration (config/mail.php).",

  // ── shell / navigation ──
  "Main": "Principal", "Main navigation": "Navigation principale", "Dashboard": "Tableau de bord", "Order Creation": "Création commande",
  "Order Management": "Gestion des commandes", "Payment & Invoice": "Paiement et facture", "Bar Sales": "Ventes bar", "Bar inventory": "Stock bar",
  "Items": "Articles", "Ingredients": "Ingrédients", "Stock Movements": "Mouvements de stock", "Stock Count": "Inventaire physique", "Suppliers": "Fournisseurs",
  "Kitchen": "Cuisine", "Kitchen Queue": "File cuisine", "Kitchen queue": "File cuisine", "Kitchen Dashboard": "Tableau cuisine", "Menu": "Menu", "Recipes": "Recettes",
  "Money & reports": "Argent et rapports", "Expenses": "Dépenses", "Cash Book": "Livre de caisse", "Advanced Reports": "Rapports avancés",
  "Reports": "Rapports", "Charts": "Graphiques", "Customer Debts": "Dettes clients", "Void Requests": "Demandes d'annulation",
  "People & admin": "Personnel et admin", "Employees": "Employés", "Audit Log": "Journal d'audit", "Settings": "Paramètres",
  "Collapse sidebar": "Réduire la barre latérale", "Open menu": "Ouvrir le menu", "Your access": "Vos accès", "Logout": "Déconnexion",
  "Gusohoka / Logout": "Gusohoka / Déconnexion", "Search (/)": "Rechercher (/)", "Notifications": "Notifications", "Mark all read": "Tout marquer comme lu",
  "Dark mode": "Mode sombre", "Light mode": "Mode clair", "New order": "Nouvelle commande", "End of Day": "Fin de journée", "End of day summary": "Résumé de fin de journée",
  "Change Date": "Changer la date", "Sound on": "Son activé", "Sound off": "Son coupé", "click to mute": "cliquer pour couper", "click to turn on": "cliquer pour activer",
  "Open shift": "Ouvrir la caisse", "Shift open": "Caisse ouverte", "Open a cash shift before taking money": "Ouvrez une caisse avant d'encaisser",
  "Your cash shift is open — click to close it": "Votre caisse est ouverte — cliquez pour la fermer",
  "RWANDA BAR MANAGEMENT": "GESTION DE BAR RWANDA", "Bar Management System — Rwanda": "Système de gestion de bar — Rwanda",
  "A product of": "Un produit de", "is a product of": "est un produit de", "BarMS is a product of IMS — Integrated Management Solutions": "BarMS est un produit d'IMS — Integrated Management Solutions",
  "Sign in": "Se connecter", "Enter your username": "Entrez votre nom d'utilisateur", "Enter your password": "Entrez votre mot de passe",
  "Invalid credentials. Try again.": "Identifiants incorrects. Réessayez.", "Access denied": "Accès refusé",
  "Starting": "Démarrage", "Ready": "Prêt", "Signed out": "Déconnecté", "Welcome": "Bienvenue",
  "You are offline — showing last saved data": "Vous êtes hors ligne — dernières données enregistrées affichées",
  "Data will refresh when connection returns": "Les données seront actualisées au retour de la connexion",
  "Install BarMS Pro": "Installer BarMS Pro", "Add to home screen for quick access": "Ajoutez à l'écran d'accueil pour un accès rapide",
  "Add to Home Screen": "Ajouter à l'écran d'accueil", "Update available — tap to refresh": "Mise à jour disponible — touchez pour actualiser",
  "BACKDATE MODE": "MODE DATE ANTÉRIEURE", "Working in:": "Travail sur :", "Working in": "Travail sur", "Return to Today": "Revenir à aujourd'hui",
  "Change Working Date": "Changer la date de travail", "Target Date": "Date cible", "All sales and orders will be recorded under the selected date": "Toutes les ventes et commandes seront enregistrées à la date choisie",
  "You can only": "Vous pouvez seulement", "add new sales": "ajouter de nouvelles ventes", "for the target date. Paid orders cannot be voided. All backdated entries are logged and visible to the Owner.": "pour la date cible. Les commandes payées ne peuvent pas être annulées. Toutes les saisies antérieures sont journalisées et visibles par le propriétaire.",
  "Important:": "Important :", "Today's Summary": "Résumé du jour", "Search products and recent sales…": "Rechercher des produits et des ventes récentes…",
  "No results found": "Aucun résultat", "No notifications": "Aucune notification", "Stock and kitchen alerts will appear here.": "Les alertes de stock et de cuisine apparaîtront ici.",
  "Owner": "Propriétaire", "Manager": "Gérant", "Bartender": "Barman", "Kitchen staff": "Personnel cuisine",

  // ── dashboard ──
  "Here is how today is going.": "Voici comment se passe la journée.", "Sales today": "Ventes du jour", "Gross profit": "Marge brute",
  "Net profit": "Bénéfice net", "running costs today": "frais de fonctionnement du jour", "running costs": "frais de fonctionnement",
  "after cost of goods": "après coût des marchandises", "in profit": "en bénéfice", "in loss": "en perte", "Orders being prepared and ready to serve": "Commandes en préparation et prêtes à servir",
  "Open queue": "Ouvrir la file", "Needs attention": "À surveiller", "Things to act on today": "À traiter aujourd'hui", "Items low on stock": "Articles en stock bas",
  "Void and refund requests": "Demandes d'annulation et de remboursement", "Unread notifications": "Notifications non lues", "All clear": "Rien à signaler",
  "No low stock and no pending requests.": "Aucun stock bas ni demande en attente.", "Today's Cash Flow": "Flux de trésorerie du jour",
  "Money In vs Money Out — real-time snapshot": "Entrées vs sorties d'argent — en temps réel", "Positive": "Positif", "Negative": "Négatif",
  "Money in": "Argent entrant", "Money out": "Argent sortant", "bar and kitchen sales": "ventes bar et cuisine", "expenses": "dépenses",
  "Cost of goods sold": "Coût des marchandises vendues", "stock sold, at purchase cost": "stock vendu, au prix d'achat", "Net cash flow": "Flux net",
  "money in minus money out": "entrées moins sorties", "Monthly Sales — Last 6 Months": "Ventes mensuelles — 6 derniers mois",
  "Today's Sales Activity": "Ventes du jour", "All sales": "Toutes les ventes", "Low Stock Alerts": "Alertes de stock bas",
  "items at or below their alert level": "articles au niveau d'alerte ou en dessous", "No sales yet today": "Pas encore de ventes aujourd'hui",
  "Sales appear here as soon as they are paid.": "Les ventes apparaissent ici dès leur paiement.", "Stock levels are fine": "Les niveaux de stock sont corrects",
  "No item is below its alert level.": "Aucun article sous son seuil d'alerte.", "Out of stock": "Épuisé", "Kitchen is quiet": "Cuisine calme",
  "No food orders are being prepared.": "Aucune commande de cuisine en préparation.", "Waiting": "En attente", "Accepted": "Acceptée", "Preparing": "En préparation",
  "Ready to serve": "Prête à servir", "Product": "Produit", "Stock": "Stock", "Alert": "Alerte", "Sold By": "Vendu par", "Updated": "Mis à jour",
  "Could not load the dashboard": "Impossible de charger le tableau de bord", "Check the connection, then refresh.": "Vérifiez la connexion, puis actualisez.",
  "Dashboard updated": "Tableau actualisé", "Release to refresh": "Relâcher pour actualiser", "Refreshing…": "Actualisation…",

  // ── order creation / order screen / payment ──
  "New order ": "Nouvelle commande", "Choose how the customer is ordering": "Choisissez comment le client commande", "Type ": "Type", "Table": "Table", "Confirm ": "Confirmer",
  "Dine-in": "Sur place", "Dine-In": "Sur place", "Takeaway": "À emporter", "Customer sits at a table": "Le client s'installe à une table",
  "Customer takes the order to go": "Le client emporte la commande", "Free": "Libre", "Occupied": "Occupée", "Cleaning": "Nettoyage",
  "Start order": "Commencer", "Open order": "Ouvrir la commande", "Add a table": "Ajouter une table", "seats": "places",
  "No tables yet": "Pas encore de tables", "Add your first table to start dine-in orders.": "Ajoutez votre première table pour les commandes sur place.",
  "New dine-in order": "Nouvelle commande sur place", "New takeaway order": "Nouvelle commande à emporter", "Order type": "Type de commande", "Draft": "Brouillon",
  "Create order": "Créer la commande", "to create": "pour créer", "A sequence number will be assigned": "Un numéro sera attribué",
  "Add New Table": "Ajouter une table", "Table Name": "Nom de la table", "Seating Capacity": "Nombre de places", "Add Table": "Ajouter la table",
  "e.g. T01, VIP, Outside…": "ex. T01, VIP, Terrasse…", "Enter a table name": "Saisissez un nom de table",
  "Open orders": "Commandes ouvertes", "Paid orders": "Commandes payées", "Orders that are not paid yet": "Commandes pas encore payées",
  "Validated": "Validée", "Paid": "Payée", "Refunded": "Remboursée", "No open orders": "Aucune commande ouverte", "Every order has been paid.": "Toutes les commandes ont été payées.",
  "Could not load orders": "Impossible de charger les commandes", "Check the connection and try again.": "Vérifiez la connexion et réessayez.",
  "No paid orders yet": "Pas encore de commandes payées", "Paid orders appear here after checkout.": "Les commandes payées apparaissent ici après l'encaissement.",
  "Could not load paid orders": "Impossible de charger les commandes payées", "Loading orders": "Chargement des commandes", "Loading paid orders": "Chargement des commandes payées",
  "Search products": "Rechercher un produit", "Drinks": "Boissons", "Current order": "Commande en cours", "Order": "Commande", "Order note (optional)": "Note de commande (facultatif)",
  "No items yet": "Pas encore d'articles", "Tap a product to add it to this order.": "Touchez un produit pour l'ajouter à la commande.",
  "No products found": "Aucun produit trouvé", "Try another name or category.": "Essayez un autre nom ou une autre catégorie.",
  "Validate order": "Valider la commande", "Proceed to payment": "Passer au paiement", "in stock": "en stock", "Cocktail": "Cocktail",
  "One less": "Un de moins", "One more": "Un de plus", "Order details": "Détails de la commande", "Waiting for kitchen": "En attente de la cuisine",
  "Accepted by kitchen": "Acceptée par la cuisine", "Ready for pickup": "Prête à récupérer", "Food served": "Plats servis", "Rejected by kitchen": "Refusée par la cuisine",
  "Order validated": "Commande validée", "Order validated — food sent to the kitchen": "Commande validée — plats envoyés en cuisine",
  "This order can no longer be changed": "Cette commande ne peut plus être modifiée", "Order is already validated": "La commande est déjà validée",
  "Payment": "Paiement", "Back to order": "Retour à la commande", "Collect payment and issue receipt": "Encaisser et émettre le reçu", "Invoice": "Facture",
  "Item": "Article", "Amount to collect": "Montant à encaisser", "Payment method": "Moyen de paiement", "Payment Method": "Moyen de paiement",
  "Cash": "Espèces", "Card": "Carte", "Bank": "Banque", "Mixed": "Mixte", "Discount": "Remise", "Receipt": "Reçu", "Both": "Les deux",
  "Customer phone (for SMS)": "Téléphone du client (pour SMS)", "Take payment": "Encaisser",
  "After payment the table becomes free and you return to the orders list.": "Après le paiement, la table est libérée et vous revenez à la liste des commandes.",
  "You have no open shift, so this payment will not be in a cash count. Open a shift from the top bar.": "Vous n'avez pas de caisse ouverte : ce paiement ne sera pas dans un comptage de caisse. Ouvrez une caisse depuis la barre du haut.",
  "Payment received": "Paiement reçu", "Paid — receipt": "Payé — reçu", "Print receipt": "Imprimer le reçu", "table is free": "table libérée",
  "keys 1–5": "touches 1–5", "Payment successful!": "Paiement réussi !", "Give a reason for the discount": "Indiquez le motif de la remise",
  "Discount cannot be more than the total": "La remise ne peut pas dépasser le total", "Select an order first": "Sélectionnez d'abord une commande",
  "Validate the order first": "Validez d'abord la commande", "Enter a phone number to send SMS": "Saisissez un numéro pour envoyer le SMS",
  "Kitchen rejected the food on this order. Void it and create a new order without that food.": "La cuisine a refusé les plats de cette commande. Annulez-la et créez une nouvelle commande sans ces plats.",
  "Add items first": "Ajoutez d'abord des articles", "Item removed": "Article retiré", "Remove this item?": "Retirer cet article ?",

  // ── kitchen ──
  "Food orders from the floor, oldest first": "Commandes de plats de la salle, les plus anciennes d'abord", "New": "Nouvelles", "active": "actives",
  "No new orders": "Aucune nouvelle commande", "New food orders appear here.": "Les nouvelles commandes de plats apparaissent ici.",
  "Nothing cooking": "Rien en cuisson", "Accepted orders move here.": "Les commandes acceptées arrivent ici.", "Nothing waiting": "Rien en attente",
  "Ready orders wait here for pickup.": "Les commandes prêtes attendent ici.", "Accept": "Accepter", "Reject": "Refuser", "Start preparing": "Commencer la préparation",
  "Mark ready": "Marquer prête", "Mark served": "Marquer servie", "Estimated": "Estimé", "Queue position": "Position dans la file", "Can Prepare": "Peut être préparée",
  "Limited Stock": "Stock limité", "Cannot Prepare": "Impossible à préparer", "Confirm or adjust the prep time:": "Confirmez ou ajustez le temps de préparation :",
  "Minutes": "Minutes", "Confirm & Start Timer": "Confirmer et lancer le minuteur", "Select a reason:": "Choisissez un motif :", "Ingredient Unavailable": "Ingrédient indisponible",
  "Kitchen Overloaded": "Cuisine surchargée", "Equipment Issue": "Problème d'équipement", "Confirm Rejection": "Confirmer le refus",
  "Order accepted — timer started": "Commande acceptée — minuteur lancé", "Order rejected": "Commande refusée", "Started preparing": "Préparation commencée",
  "Marked as ready": "Marquée prête", "Marked as served": "Marquée servie", "Please select a reason": "Veuillez choisir un motif", "Enter a valid time": "Saisissez un temps valide",
  "Kitchen operations overview": "Vue d'ensemble de la cuisine", "Food Sales": "Ventes de plats", "Today's Sales": "Ventes du jour", "Today's Profit": "Bénéfice du jour",
  "Food Cost": "Coût des aliments", "Kitchen Expenses (Today)": "Dépenses cuisine (aujourd'hui)", "Purchases": "Achats", "Waste": "Pertes", "Adjustments": "Ajustements",
  "Top Selling Foods": "Plats les plus vendus", "All ingredients well stocked": "Tous les ingrédients sont en stock", "Food items sold to customers": "Plats vendus aux clients",
  "Food Name": "Nom du plat", "e.g. Rolex Omelet": "ex. Rolex Omelette", "e.g. Breakfast, Main, Drinks": "ex. Petit-déjeuner, Plat, Boissons",
  "Linked Recipe": "Recette liée", "— No Recipe —": "— Aucune recette —", "Add Menu Item": "Ajouter un plat", "Edit Menu Item": "Modifier le plat",
  "Define how each menu item is made": "Définissez la composition de chaque plat", "Add Recipe": "Ajouter une recette", "Recipe Name": "Nom de la recette",
  "Linked Menu Item": "Plat lié", "Recipe Ingredients": "Ingrédients de la recette", "Save Recipe": "Enregistrer la recette", "e.g. Rolex Recipe": "ex. Recette Rolex",
  "No ingredients in this recipe yet": "Pas encore d'ingrédients dans cette recette", "No recipes yet — add one": "Pas encore de recettes — ajoutez-en une",
  "Kitchen stock management": "Gestion du stock cuisine", "Ingredient Name": "Nom de l'ingrédient", "e.g. Eggs": "ex. Œufs", "Cost per Unit (RWF)": "Coût par unité (RWF)",
  "Minimum Stock Alert": "Alerte de stock minimum", "Minimum Stock Alert Level": "Seuil d'alerte de stock minimum", "pcs, kg, L, g…": "pcs, kg, L, g…",
  "No ingredients yet — add one": "Pas encore d'ingrédients — ajoutez-en un", "Click a dish to see what each ingredient costs": "Cliquez sur un plat pour voir le coût de chaque ingrédient",
  "Cost per serving": "Coût par portion", "Profit per serving": "Bénéfice par portion", "Used per serving": "Utilisé par portion", "Share of cost": "Part du coût",
  "Total ingredient cost": "Coût total des ingrédients", "Costs use the average purchase price of each ingredient.": "Les coûts utilisent le prix d'achat moyen de chaque ingrédient.",
  "Dish": "Plat", "Plate": "Assiette", "Bowl / soup": "Bol / soupe", "Grill / skewer": "Grillade / brochette", "Grill": "Grillade",

  // ── items / stock ──
  "What you sell — Direct items and Recipe cocktails": "Ce que vous vendez — articles directs et cocktails à recette", "Add Item": "Ajouter un article",
  "Total Stock Value": "Valeur totale du stock", "Items In Stock": "Articles en stock", "Direct": "Direct", "Recipe": "Recette", "Search items...": "Rechercher des articles…",
  "Buy Cost / Unit": "Coût d'achat / unité", "Stock Value": "Valeur du stock", "Low stock": "Stock bas", "Change photo": "Changer la photo",
  "Add Bar Item": "Ajouter un article bar", "Edit Item": "Modifier l'article", "Item Name": "Nom de l'article", "e.g. Heineken, Mojito": "ex. Heineken, Mojito",
  "Picture type": "Type d'image", "— shown until you upload a real photo": "— affichée jusqu'à l'ajout d'une vraie photo", "Selling Price (RWF)": "Prix de vente (RWF)",
  "Buy Price / Cost per Unit (RWF)": "Prix d'achat / coût par unité (RWF)", "What you paid for it": "Ce que vous l'avez payé", "Recipe (Cocktail)": "Recette (cocktail)",
  "Bought in (optional)": "Acheté par (facultatif)", "— single units only —": "— à l'unité seulement —", "Crate": "Casier", "Carton": "Carton", "Box": "Boîte", "Pack": "Paquet", "Case": "Caisse",
  "Units per pack": "Unités par lot", "e.g. 12 or 24": "ex. 12 ou 24", "Current Stock": "Stock actuel", "Min Stock Alert": "Alerte de stock minimum",
  "Save Item": "Enregistrer l'article", "Cost is calculated from the recipe ingredients": "Le coût est calculé à partir des ingrédients de la recette",
  "No ingredients added yet": "Pas encore d'ingrédients ajoutés", "Select ingredient...": "Choisir un ingrédient…", "Delete this item?": "Supprimer cet article ?",
  "Product photo": "Photo du produit", "Upload photo": "Ajouter une photo", "Replace photo": "Remplacer la photo", "Remove this photo?": "Retirer cette photo ?",
  "Use a clear photo of the real bottle, can or dish on a plain background. JPG, PNG or WebP, up to 3 MB.": "Utilisez une photo nette de la vraie bouteille, canette ou du plat sur un fond uni. JPG, PNG ou WebP, 3 Mo maximum.",
  "Photo saved": "Photo enregistrée", "Photo removed": "Photo retirée", "Image is larger than 3 MB": "L'image dépasse 3 Mo", "Upload failed — check the connection": "Échec de l'envoi — vérifiez la connexion",
  "Beer": "Bière", "Soft drink": "Boisson gazeuse", "Spirit": "Spiritueux", "Wine": "Vin", "Water": "Eau", "Juice": "Jus", "Hot drink": "Boisson chaude",
  "Local brew": "Boisson locale", "Other drink": "Autre boisson", "Drink": "Boisson", "Auto": "Auto",
  "Physical bar stock — what you store": "Stock physique du bar — ce que vous stockez", "Add Ingredient": "Ajouter un ingrédient", "Bar ingredient": "Ingrédient bar",
  "Complete history of all stock changes": "Historique complet des mouvements de stock", "Qty Change": "Variation", "Done By": "Fait par", "Reason / Order": "Motif / commande",
  "Receive Stock": "Réceptionner du stock", "Receive & Adjust Stock": "Réceptionner et ajuster le stock", "Quantity to add": "Quantité à ajouter",
  "Purchase cost per unit (RWF)": "Coût d'achat par unité (RWF)", "Purchase Date": "Date d'achat", "Supplier": "Fournisseur", "Supplier (optional)": "Fournisseur (facultatif)",
  "Supplier name": "Nom du fournisseur", "Amount paid now (RWF)": "Montant payé maintenant (RWF)", "Invoice / receipt no.": "N° de facture / reçu",
  "Leave \"Amount paid now\" empty if you paid in full. Anything unpaid is recorded as owed to the supplier.": "Laissez « Montant payé maintenant » vide si vous avez tout payé. Le reste est enregistré comme dû au fournisseur.",
  "Record Breakage": "Enregistrer une casse", "Record Waste": "Enregistrer une perte", "Breakages": "Casses", "Stock received": "Stock réceptionné", "Breakage recorded": "Casse enregistrée",
  "Buy cost is required for direct items": "Le coût d'achat est obligatoire pour les articles directs", "Name and selling price are required": "Le nom et le prix de vente sont obligatoires",
  "Add at least one ingredient to the recipe": "Ajoutez au moins un ingrédient à la recette", "Select ingredient and enter quantity": "Choisissez un ingrédient et saisissez la quantité",
  "Count what is physically on the shelves and compare it with BarMS": "Comptez ce qui est physiquement en rayon et comparez avec BarMS",
  "Count date": "Date du comptage", "Counted by": "Compté par", "Previous counts": "Comptages précédents", "Save count only": "Enregistrer le comptage seulement",
  "Save and set stock to the count": "Enregistrer et mettre le stock au comptage", "No count recorded yet": "Aucun comptage enregistré",
  "Never counted — due now": "Jamais compté — à faire maintenant", "Stock count overdue": "Inventaire en retard", "Last physical stock count": "Dernier inventaire physique",
  "e.g. Monthly count, counted by Ann and Bob": "ex. Comptage mensuel, par Ann et Bob", "Enter at least one counted quantity": "Saisissez au moins une quantité comptée",
  "Leave an item empty to skip it. \"Set stock to the count\" records an adjustment for every difference, so nothing changes without a record. Differences are not proof of wrongdoing — check for missing deliveries, breakages or sales first.": "Laissez un article vide pour l'ignorer. « Mettre le stock au comptage » enregistre un ajustement pour chaque écart, rien ne change sans trace. Un écart n'est pas une preuve de faute — vérifiez d'abord les livraisons, casses ou ventes manquantes.",
  "Stock count schedule": "Calendrier d'inventaire", "Count every": "Compter tous les", "Every week (7 days)": "Chaque semaine (7 jours)", "Every month (30 days)": "Chaque mois (30 jours)",
  "How often stock must be physically counted. When a count is overdue, the Owner and managers are reminded at login and Advanced Reports flags it.": "Fréquence de l'inventaire physique. Quand il est en retard, le propriétaire et les gérants sont avertis à la connexion et les rapports avancés le signalent.",
  "What each supplier delivered, what was paid, and what is still owed": "Ce que chaque fournisseur a livré, ce qui a été payé et ce qui reste dû",
  "Suppliers come from the name typed when receiving stock. To record a debt, receive the stock and enter less than the full amount in \"Amount paid now\".": "Les fournisseurs viennent du nom saisi à la réception du stock. Pour enregistrer une dette, réceptionnez le stock et saisissez moins que le total dans « Montant payé maintenant ».",
  "Total owed to suppliers": "Total dû aux fournisseurs", "Owed to suppliers": "Dû aux fournisseurs", "Owed to suppliers now": "Dû aux fournisseurs actuellement",
  "Suppliers with a balance": "Fournisseurs avec un solde", "Bought": "Acheté", "Bought from": "Acheté chez", "Still owed": "Reste dû", "Last delivery": "Dernière livraison",
  "Deliveries": "Livraisons", "Paid on delivery": "Payé à la livraison", "Paid later": "Payé plus tard", "Left unpaid": "Laissé impayé", "Pay": "Payer",
  "Last purchase": "Dernier achat", "Last bought": "Dernier achat", "Price paid per unit over time": "Prix payé par unité dans le temps",
  "Current Stock Value": "Valeur actuelle du stock", "Stock & Items": "Stock et articles",

  // ── expenses / cash book / debts ──
  "Record Expense": "Enregistrer une dépense", "Paid with": "Payé avec", "Cash (from the drawer)": "Espèces (de la caisse)", "Expense History": "Historique des dépenses",
  "Total this month:": "Total ce mois :", "Total this month": "Total ce mois", "Recorded By": "Enregistré par", "Void": "Annuler", "General": "Général",
  "e.g. Electricity bill, cleaning supplies…": "ex. Facture d'électricité, produits d'entretien…", "Expense": "Dépense", "Expense voided": "Dépense annulée",
  "Utilities": "Charges", "Transport": "Transport", "Maintenance": "Entretien", "Marketing": "Marketing", "Salaries": "Salaires", "Rent": "Loyer", "Supplies": "Fournitures",
  "Expense saved offline — will sync when connected": "Dépense enregistrée hors ligne — synchronisée à la reconnexion",
  "Money that is not a sale or an expense — it changes cash, never profit": "Argent qui n'est ni une vente ni une dépense — il change la caisse, jamais le bénéfice",
  "Record money movement": "Enregistrer un mouvement d'argent", "Owner withdrawal": "Retrait du propriétaire", "Owner withdrawals": "Retraits du propriétaire",
  "Owner withdrawals (this month)": "Retraits du propriétaire (ce mois)", "Capital & loans in (this month)": "Capital et prêts reçus (ce mois)",
  "Loan repayments (this month)": "Remboursements de prêts (ce mois)", "Transfers (this month)": "Virements (ce mois)", "Net cash movement": "Mouvement net de trésorerie",
  "Every money movement": "Chaque mouvement d'argent", "Money by account": "Argent par compte", "Cash drawer": "Caisse",
  "Shows this month. Owner withdrawals, capital and loans appear in Advanced Reports → Expenses & Cash, but are never counted as income or expenses.": "Affiche ce mois. Les retraits du propriétaire, le capital et les prêts apparaissent dans Rapports avancés → Dépenses et caisse, mais ne comptent jamais comme revenus ou dépenses.",
  "Record Customer Debt": "Enregistrer une dette client", "Customer Name": "Nom du client", "Amount Owed (RWF)": "Montant dû (RWF)", "Debt Date": "Date de la dette",
  "Description / Items Taken": "Description / articles pris", "Record Debt": "Enregistrer la dette", "Unpaid Debts": "Dettes impayées", "Paid Debts": "Dettes payées",
  "No unpaid debts": "Aucune dette impayée", "No paid debts yet": "Pas encore de dettes payées", "Paid Date": "Date de paiement", "Customers owe": "Les clients doivent",
  "e.g. Jean Paul…": "ex. Jean Paul…", "e.g. 2 Primus + 1 Nyama Choma…": "ex. 2 Primus + 1 Nyama Choma…",

  // ── void requests / refunds ──
  "Sale Void Requests": "Demandes d'annulation de vente", "Expense Void Requests": "Demandes d'annulation de dépense", "Requested By": "Demandé par",
  "Requested by": "Demandé par", "Approved by": "Approuvé par", "No void requests yet": "Pas encore de demandes d'annulation", "Approve": "Approuver",
  "Void / Refund": "Annulation / remboursement", "Refund": "Remboursement", "Request Refund": "Demander un remboursement", "Confirm Refund": "Confirmer le remboursement",
  "Send to Owner": "Envoyer au propriétaire", "Choose how many of each item to refund.": "Choisissez combien de chaque article rembourser.",
  "Refund qty": "Qté à rembourser", "Refund total": "Total remboursé", "Full amount": "Montant total", "Money returned by": "Argent rendu par",
  "Sealed — back in stock": "Scellé — remis en stock", "Back in stock": "Remis en stock", "Food — not restocked": "Plat — non remis en stock",
  "= the customer paid but is given money back. Needs the Owner's permission: without it, your refund is sent to the Owner to approve. It is subtracted from revenue on the day it is given.": "= le client a payé mais est remboursé. Nécessite l'autorisation du propriétaire : sans elle, votre remboursement lui est envoyé pour approbation. Il est déduit du revenu le jour où il est donné.",
  "= this sale never really happened (entered by mistake). The Owner checks and approves it; everything is reversed.": "= cette vente n'a jamais vraiment eu lieu (saisie par erreur). Le propriétaire vérifie et approuve ; tout est annulé.",
  "e.g. Drink was flat, customer complained": "ex. Boisson éventée, le client s'est plaint", "Request submitted to Owner": "Demande envoyée au propriétaire",
  "Request approved and void applied": "Demande approuvée et annulation appliquée", "Request rejected": "Demande refusée", "Please enter a reason": "Veuillez saisir un motif",
  "A reason is required": "Un motif est obligatoire", "Enter how many items to refund": "Indiquez combien d'articles rembourser", "This order is already voided": "Cette commande est déjà annulée",

  // ── reports ──
  "Pick a day:": "Choisir un jour :", "Validate Report": "Valider le rapport", "Export PDF": "Exporter en PDF", "Total revenue": "Revenu total", "Gross margin": "Marge brute",
  "Average order": "Commande moyenne", "Transactions": "Transactions", "Stock value now": "Valeur du stock actuelle", "Revenue Breakdown": "Répartition du revenu",
  "Bar Revenue": "Revenu bar", "Kitchen Revenue": "Revenu cuisine", "Cost of Goods (COGS)": "Coût des marchandises (CMV)", "Operating Expenses": "Charges d'exploitation",
  "Inventory Purchases": "Achats de stock", "Refunds given (already deducted)": "Remboursements (déjà déduits)", "Total Net Profit": "Bénéfice net total",
  "Net Margin:": "Marge nette :", "Top Selling Products": "Produits les plus vendus", "By Revenue": "Par revenu", "No sales data": "Aucune donnée de vente",
  "Staff Performance": "Performance du personnel", "Rankings": "Classement", "Staff": "Personnel", "No staff data": "Aucune donnée du personnel",
  "Expenses by Category": "Dépenses par catégorie", "No expenses": "Aucune dépense", "Unit Cost": "Coût unitaire", "Total Cost": "Coût total", "Reference": "Référence",
  "No recorded purchases for this period": "Aucun achat enregistré pour cette période", "Refunds": "Remboursements", "Voids": "Annulations",
  "Monthly sales": "Ventes mensuelles", "This year, bar and kitchen together": "Cette année, bar et cuisine ensemble", "Bar and kitchen": "Bar et cuisine",
  "Share of this month's sales": "Part des ventes du mois", "Sales and expenses": "Ventes et dépenses", "this month": "ce mois", "Sales": "Ventes",
  "Full report (PDF / Print)": "Rapport complet (PDF / impression)", "Excel workbook": "Classeur Excel", "Bar + Kitchen": "Bar + cuisine", "Bar": "Bar",
  "Summary": "Résumé", "Products": "Produits", "Purchases ": "Achats", "Expenses & Cash": "Dépenses et caisse", "To review": "À vérifier", "About the data": "À propos des données",
  "Money": "Argent", "Net sales": "Ventes nettes", "orders": "commandes", "of sales kept": "des ventes conservées", "Net operating profit": "Résultat d'exploitation",
  "before tax": "avant impôt", "What the business holds and owes": "Ce que l'entreprise possède et doit", "Stock value": "Valeur du stock", "could sell for": "pourrait se vendre",
  "Money received": "Argent reçu", "after refunds": "après remboursements", "unpaid": "impayé", "Need attention": "À surveiller", "Points to review": "Points à vérifier",
  "Cash drawer by shift": "Caisse par service", "Discounts & refunds": "Remises et remboursements", "Low or out of stock": "Stock bas ou épuisé",
  "Sales and profit by day": "Ventes et bénéfice par jour", "Hover a day to see its figures": "Survolez un jour pour voir ses chiffres",
  "Hover a day to see net sales and gross profit": "Survolez un jour pour voir les ventes nettes et la marge brute", "What stands out": "Ce qui ressort",
  "How customers paid": "Comment les clients ont payé", "Best-selling items": "Articles les plus vendus", "Click a day to see every sale": "Cliquez sur un jour pour voir chaque vente",
  "Day by day": "Jour par jour", "Show all columns": "Afficher toutes les colonnes", "Profit earned on drinks": "Bénéfice gagné sur les boissons", "Drink sales": "Ventes de boissons",
  "Average margin": "Marge moyenne", "Profit earned by product": "Bénéfice par produit", "Profit earned": "Bénéfice gagné", "Avg cost": "Coût moyen", "Avg cost / unit": "Coût moyen / unité",
  "Sold": "Vendu", "Running low": "Bientôt épuisé", "Sales falling": "Ventes en baisse", "Missing cost": "Coût manquant", "No cost": "Sans coût",
  "Profit / unit = price − average purchase cost · Profit earned = sales − cost of the units sold": "Bénéfice / unité = prix − coût d'achat moyen · Bénéfice gagné = ventes − coût des unités vendues",
  "Total stock value": "Valeur totale du stock", "at purchase cost": "au prix d'achat", "Could sell for": "Pourrait se vendre", "drinks at today's prices": "boissons aux prix du jour",
  "Potential profit": "Bénéfice potentiel", "not earned yet": "pas encore gagné", "Low / out of stock": "Bas / épuisé", "Where the stock value is": "Où se trouve la valeur du stock",
  "Biggest items": "Articles les plus importants", "Quantities on hand": "Quantités en stock", "Stock on hand": "Stock disponible",
  "Stock on hand now, at average purchase cost": "Stock disponible maintenant, au coût d'achat moyen", "Unexplained stock": "Stock inexpliqué",
  "Different units are never added together": "Des unités différentes ne sont jamais additionnées",
  "Values use the current average purchase cost. \"Show all columns\" adds the movements: opening + bought − sold − wasted + returned ± adjusted = quantity now.": "Les valeurs utilisent le coût d'achat moyen actuel. « Afficher toutes les colonnes » ajoute les mouvements : ouverture + achats − ventes − pertes + retours ± ajustements = quantité actuelle.",
  "Kitchen sales": "Ventes cuisine", "Ingredients used": "Ingrédients utilisés", "Kitchen profit": "Bénéfice cuisine", "Dishes without recipe": "Plats sans recette",
  "Dishes": "Plats", "Cost / portion": "Coût / portion", "No recipe — cost unknown": "Pas de recette — coût inconnu", "The kitchen sold nothing in this period.": "La cuisine n'a rien vendu sur cette période.",
  "Ingredient cost": "Coût des ingrédients", "Ingredient cost of sales is estimated at today's average ingredient cost.": "Le coût des ingrédients vendus est estimé au coût moyen actuel des ingrédients.",
  "Ingredients carry cost only — the profit belongs to the dishes that use them": "Les ingrédients ne portent qu'un coût — le bénéfice revient aux plats qui les utilisent",
  "Stock bought": "Stock acheté", "deliveries": "livraisons", "Stock purchases are not expenses: they become a cost only when the stock is sold or used.": "Les achats de stock ne sont pas des dépenses : ils deviennent un coût seulement quand le stock est vendu ou utilisé.",
  "Supplier balances (all time)": "Soldes fournisseurs (depuis le début)", "Total value of differences": "Valeur totale des écarts", "Value of differences": "Valeur des écarts",
  "Value of difference": "Valeur de l'écart", "possible impact": "impact possible", "not proof of wrongdoing": "pas une preuve de faute", "Expenses by category": "Dépenses par catégorie",
  "Sales by staff": "Ventes par employé", "Start cash": "Fonds de caisse", "Sales collected": "Ventes encaissées", "Refunds paid": "Remboursements payés",
  "Shifts still open": "Services encore ouverts", "No closed shift": "Aucun service clôturé", "No shifts in this period": "Aucun service sur cette période",
  "No shift was closed, so the cash drawer was not checked in this period.": "Aucun service n'a été clôturé, la caisse n'a donc pas été vérifiée sur cette période.",
  "No shifts in this period. Staff open a shift from the top bar.": "Aucun service sur cette période. Le personnel ouvre un service depuis la barre du haut.",
  "No expenses in this period": "Aucune dépense sur cette période", "No expenses were recorded in this period.": "Aucune dépense n'a été enregistrée sur cette période.",
  "Mixed payments": "Paiements mixtes", "Orders paid without an open shift (not in any cash count)": "Commandes payées sans service ouvert (hors comptage de caisse)",
  "Expenses with no payment method": "Dépenses sans moyen de paiement", "Purchases with no payment recorded (treated as paid)": "Achats sans paiement enregistré (considérés payés)",
  "Limits of these reports": "Limites de ces rapports", "Figures that cannot be exact are labelled instead of being guessed": "Les chiffres qui ne peuvent pas être exacts sont signalés au lieu d'être devinés",
  "Taxes": "Taxes", "Taxes (VAT, income tax) are not recorded in BarMS, so net operating profit is before tax.": "Les taxes (TVA, impôt sur le revenu) ne sont pas enregistrées dans BarMS : le résultat d'exploitation est avant impôt.",
  "Historical stock cost": "Coût historique du stock", "Stock values for past dates use today's average cost, because BarMS keeps only the current average cost.": "Les valeurs de stock passées utilisent le coût moyen actuel, car BarMS ne conserve que le coût moyen actuel.",
  "\"Mixed\" payments are not split into cash and other methods, so they are not counted as cash in the drawer.": "Les paiements « Mixte » ne sont pas répartis entre espèces et autres moyens : ils ne comptent pas comme espèces en caisse.",
  "Sale lines with cost recorded at the moment of sale": "Lignes de vente avec coût enregistré au moment de la vente", "Sale lines costed at today's average cost (estimated)": "Lignes de vente au coût moyen actuel (estimé)",
  "Sale lines with no cost at all (profit overstated)": "Lignes de vente sans aucun coût (bénéfice surestimé)", "Sales from the old Quick Sale system in this period": "Ventes de l'ancien système Vente rapide sur cette période",
  "Manually typed kitchen revenue entries in this period": "Revenus cuisine saisis à la main sur cette période", "In Stock Without Cost": "En stock sans coût",
  "These are differences between what BarMS expects and what it holds. An unexplained difference is": "Ce sont des écarts entre ce que BarMS attend et ce qu'il détient. Un écart inexpliqué n'est",
  "— it is often a missing record. Nothing here changes stock or past records; corrections must be made through the normal screens.": "— c'est souvent un enregistrement manquant. Rien ici ne modifie le stock ni l'historique ; les corrections se font dans les écrans habituels.",
  "The whole report as a professional document — print it or choose “Save as PDF”": "Le rapport complet en document professionnel — imprimez-le ou choisissez « Enregistrer en PDF »",
  "The whole report as an Excel file, one sheet per section": "Le rapport complet en fichier Excel, une feuille par section", "Preparing the full report…": "Préparation du rapport complet…",
  "Preparing the Excel workbook…": "Préparation du classeur Excel…", "Nothing to export for this period": "Rien à exporter pour cette période", "Calculating the report": "Calcul du rapport",
  "Drawing the chart": "Tracé du graphique", "Business performance, stock value and profitability": "Performance, valeur du stock et rentabilité",
  "Mark under review": "Mettre en examen", "Mark resolved": "Marquer résolu", "Dismiss issue": "Écarter le point", "Reopen issue": "Rouvrir le point",
  "Write a note explaining the resolution": "Écrivez une note expliquant la résolution", "Issue updated": "Point mis à jour",
  "Sales, purchases, expenses and profit reports — allowed": "Rapports de ventes, achats, dépenses et bénéfices — autorisé",

  // ── employees ──
  "Debts / Advances": "Dettes / avances", "Pay Salary": "Payer le salaire", "Performance": "Performance", "Add Employee": "Ajouter un employé", "Full Name": "Nom complet",
  "Bartender, Waiter…": "Barman, serveur…", "Monthly Salary (RWF)": "Salaire mensuel (RWF)", "BarMS account (login)": "Compte BarMS (connexion)", "BarMS account": "Compte BarMS",
  "— No account —": "— Aucun compte —", "Link it so this employee's sales and work are tracked automatically": "Liez-le pour suivre automatiquement les ventes et le travail de cet employé",
  "Save Employee": "Enregistrer l'employé", "Clear": "Effacer", "All Employees": "Tous les employés", "Monthly Salary (RWF) ": "Salaire mensuel (RWF)", "Hire Date": "Date d'embauche",
  "No employees yet": "Pas encore d'employés", "Employee": "Employé", "Record Debt / Advance": "Enregistrer une dette / avance", "Advance, loan…": "Avance, prêt…",
  "Debt History": "Historique des dettes", "No debts recorded": "Aucune dette enregistrée", "Pay Salaries": "Payer les salaires", "Deductions": "Retenues", "Net Paid": "Net payé",
  "Salary Payment History": "Historique des salaires", "No salary payments yet": "Pas encore de salaires payés", "April salary, bonus…": "Salaire d'avril, prime…",
  "Gross Salary": "Salaire brut", "Net Pay": "Salaire net", "Loading performance": "Chargement de la performance",

  // ── settings / users / audit ──
  "Bar Configuration": "Configuration du bar", "Bar Name": "Nom du bar", "Location": "Emplacement", "Currency": "Devise", "Save Settings": "Enregistrer les paramètres",
  "User Management": "Gestion des utilisateurs", "Add New User": "Ajouter un utilisateur", "Add User": "Ajouter l'utilisateur", "lowercase, no spaces": "minuscules, sans espaces",
  "Manager Permissions": "Autorisations des gérants", "— Owner only": "— propriétaire seulement", "Control what managers can access and do in the system.": "Définissez ce que les gérants peuvent voir et faire.",
  "Allow everything": "Tout autoriser", "Remove everything": "Tout retirer", "allowed": "autorisé", "not allowed": "non autorisé",
  "View Reports & Charts": "Voir les rapports et graphiques", "View Audit Log": "Voir le journal d'audit", "Approve Void Requests": "Approuver les annulations",
  "Give Discounts": "Accorder des remises", "Give Refunds": "Accorder des remboursements", "Manage Items, Menu & Prices": "Gérer articles, menu et prix",
  "Record Expenses": "Enregistrer les dépenses", "Void Expenses": "Annuler des dépenses", "Manage Staff Logins": "Gérer les comptes du personnel",
  "Delete Debts & Kitchen Revenue": "Supprimer dettes et revenus cuisine", "Edit Bar Settings": "Modifier les paramètres du bar",
  "Change My Password": "Changer mon mot de passe", "Current Password": "Mot de passe actuel", "New Password": "Nouveau mot de passe", "Change Password": "Changer le mot de passe",
  "Data Backup & Restore": "Sauvegarde et restauration", "Export all your data as a backup file, or restore from a previous backup.": "Exportez toutes vos données en fichier de sauvegarde ou restaurez une sauvegarde précédente.",
  "Backup Now — Download JSON": "Sauvegarder maintenant — télécharger JSON", "Restore from Backup": "Restaurer une sauvegarde", "Local Data & Storage": "Données locales et stockage",
  "Local storage used": "Stockage local utilisé", "Pending sync items": "Éléments en attente de synchronisation", "Last data purge": "Dernière purge des données",
  "Purge Old Data": "Purger les anciennes données", "Synchronisation": "Synchronisation", "Online — nothing on this device is waiting to sync.": "En ligne — rien sur cet appareil n'attend de synchronisation.",
  "IMS License Settings": "Paramètres de licence IMS", "License Status": "Statut de la licence", "Your license information.": "Vos informations de licence.",
  "Sync License Now": "Synchroniser la licence", "Your Device ID": "ID de votre appareil", "Share this ID with IMS Company if asked": "Communiquez cet ID à IMS si on vous le demande",
  "No license found": "Aucune licence trouvée", "Days before lock": "Jours avant verrouillage", "Data age: Fresh": "Âge des données : récent",
  "BarMS stores up to": "BarMS conserve jusqu'à", "of data locally.": "de données en local.",
  "Audit Log — Every Action Tracked": "Journal d'audit — chaque action enregistrée", "Filter by Action": "Filtrer par action", "Filter by User": "Filtrer par utilisateur",
  "All Actions": "Toutes les actions", "All Users": "Tous les utilisateurs", "Clear Filters": "Effacer les filtres", "Logins": "Connexions", "Price Changes": "Changements de prix",
  "Order Items": "Articles de commande", "Order Summary": "Résumé de commande",

  // ── legacy pages ──
  "Table Management": "Gestion des tables", "Open, manage and close table sessions": "Ouvrir, gérer et fermer les sessions de table", "Recent Sessions": "Sessions récentes",
  "Opened By": "Ouvert par", "Closed By": "Fermé par", "Opened": "Ouvert", "No sessions yet": "Pas encore de sessions", "No items on this table yet": "Pas encore d'articles sur cette table",
  "Remove table": "Retirer la table", "All Products": "Tous les produits", "Search products…": "Rechercher des produits…", "Search product…": "Rechercher un produit…",
  "Add Product — Click any row in the table to edit": "Ajouter un produit — cliquez sur une ligne pour la modifier", "Product Name": "Nom du produit", "e.g. Primus Beer": "ex. Primus Beer",
  "Sell Price (RWF)": "Prix de vente (RWF)", "Cost Price (RWF)": "Prix d'achat (RWF)", "Initial Stock": "Stock initial", "Low Stock Alert": "Alerte de stock bas",
  "Save Product": "Enregistrer le produit", "Prices": "Prix", "Stock Replenishment — Record New Purchase / Movement": "Réapprovisionnement — nouvel achat / mouvement",
  "Movement Type": "Type de mouvement", "IN — Add / Purchase Stock": "ENTRÉE — ajouter / acheter du stock", "OUT — Remove / Use Stock": "SORTIE — retirer / utiliser du stock",
  "Buying Price / Unit (RWF)": "Prix d'achat / unité (RWF)", "Reference No. (optional)": "N° de référence (facultatif)", "Purchase / Movement Date": "Date d'achat / de mouvement",
  "Record Movement": "Enregistrer le mouvement", "Stock Overview — Summary & Recent Movements": "Aperçu du stock — résumé et mouvements récents", "Total IN": "Total entrées",
  "Total OUT": "Total sorties", "Last Movement": "Dernier mouvement", "Last Date": "Dernière date", "e.g. Bralirwa, local market...": "ex. Bralirwa, marché local…",
  "e.g. Weekly restock from Bralirwa supplier...": "ex. Réassort hebdomadaire chez Bralirwa…", "Price & Stock": "Prix et stock", "Sales History / Ibyagurishijwe": "Historique des ventes / Ibyagurishijwe",
  "Quick Sale — Add Items": "Vente rapide — ajouter des articles", "Add Item to Order": "Ajouter à la commande", "Clear Order": "Vider la commande",
  "Total Sales": "Ventes totales", "Items Sold": "Articles vendus", "Drink sales from validated orders": "Ventes de boissons des commandes validées",
  "Full Sales Log": "Journal complet des ventes", "Unit Price": "Prix unitaire",

  // ── shift ──
  "Open a shift": "Ouvrir une caisse", "Cash in the drawer now (RWF)": "Espèces en caisse maintenant (RWF)", "Shift opened": "Caisse ouverte",
  "Count the cash already in the drawer before you start. Every cash payment, refund and cash expense during your shift is added to it, so at the end the system knows how much cash should be there.": "Comptez les espèces déjà en caisse avant de commencer. Chaque paiement, remboursement et dépense en espèces de votre service y est ajouté : à la fin, le système sait combien il doit y avoir.",
  "Count the cash and enter the amount": "Comptez les espèces et saisissez le montant", "Enter the cash in the drawer (0 if empty)": "Saisissez les espèces en caisse (0 si vide)",

  // ── messages ──
  "Saved": "Enregistré", "Deleted": "Supprimé", "Recorded": "Enregistré", "Product removed": "Produit retiré", "No changes made": "Aucune modification",
  "No internet connection": "Pas de connexion Internet", "Could not load data": "Impossible de charger les données", "Saved offline — will sync when connected": "Enregistré hors ligne — synchronisé à la reconnexion",
  "Signed out after 10 minutes of inactivity": "Déconnecté après 10 minutes d'inactivité", "View only — ask a manager to make changes": "Lecture seule — demandez à un gérant de faire les modifications",
  "Name and price are required": "Le nom et le prix sont obligatoires", "Name and unit are required": "Le nom et l'unité sont obligatoires", "Recipe name is required": "Le nom de la recette est obligatoire",
  "Recipe saved": "Recette enregistrée", "Recipe updated": "Recette mise à jour", "Delete this ingredient?": "Supprimer cet ingrédient ?", "Delete this menu item?": "Supprimer ce plat ?",
  "Delete this recipe?": "Supprimer cette recette ?", "Enter a valid quantity": "Saisissez une quantité valide", "Enter a valid selling price": "Saisissez un prix de vente valide",
  "Enter an amount": "Saisissez un montant", "Select a product": "Choisissez un produit", "Please select a date": "Veuillez choisir une date", "Fill both fields": "Remplissez les deux champs",
  "All fields required": "Tous les champs sont obligatoires", "Payment recorded": "Paiement enregistré", "Stock adjusted": "Stock ajusté", "User added!": "Utilisateur ajouté !",
  "Choose a start and end date": "Choisissez une date de début et de fin", "Choose between 1 and 90 days": "Choisissez entre 1 et 90 jours", "Returned to today": "Retour à aujourd'hui",
  "Enter the purchase cost per unit": "Saisissez le coût d'achat par unité", "Enter the supplier — the unpaid part is owed to them": "Saisissez le fournisseur — la partie impayée lui est due",
  "Amount paid must be between 0 and the total": "Le montant payé doit être entre 0 et le total", "Prices updated successfully": "Prix mis à jour",
  "Reason is required for price changes": "Un motif est obligatoire pour changer un prix", "Add items before checkout": "Ajoutez des articles avant l'encaissement",
  "Table is occupied": "La table est occupée", "Table marked as Available": "Table marquée disponible", "Table is being cleaned. Mark it Available first.": "La table est en nettoyage. Marquez-la d'abord disponible.",
  "No open order found for this table": "Aucune commande ouverte pour cette table", "Allow popups to print receipt": "Autorisez les fenêtres pour imprimer le reçu",
  "Sale voided. Stock restored.": "Vente annulée. Stock rétabli.", "Voided": "Annulé", "Only Owner or Manager can validate reports": "Seul le propriétaire ou un gérant peut valider les rapports",
  "Error loading log": "Erreur de chargement du journal", "Failed to load log": "Échec du chargement du journal", "Error loading users": "Erreur de chargement des utilisateurs",
  "Failed to load users": "Échec du chargement des utilisateurs", "Error updating permission": "Erreur de mise à jour de l'autorisation", "Please add a note or supplier name": "Ajoutez une note ou un nom de fournisseur",
  "Select a purchase or movement date": "Choisissez une date d'achat ou de mouvement", "Out of stock ": "Épuisé",
  "Stock count due: Bar ingredients (never counted). Open Stock Count.": "Inventaire à faire : ingrédients bar (jamais comptés). Ouvrez l'inventaire physique.",
  "Order saved — table is held": "Commande enregistrée — table réservée", "Could not reach IMS server. Check URL and Client ID.": "Impossible de joindre le serveur IMS. Vérifiez l'URL et l'ID client.",
  "Syncing license with IMS...": "Synchronisation de la licence avec IMS…", "License synced successfully": "Licence synchronisée", "IMS settings saved": "Paramètres IMS enregistrés",
  "Restore from file is disabled in database mode. Use cPanel → phpMyAdmin to restore data.": "La restauration depuis un fichier est désactivée en mode base de données. Utilisez cPanel → phpMyAdmin.",
  "Error activating backdate mode": "Erreur d'activation du mode date antérieure", "Error deactivating": "Erreur de désactivation",
  "Enter the cost per unit so stock value and recipe cost are correct": "Saisissez le coût par unité pour que la valeur du stock et le coût des recettes soient justes",
  "Ingredient, quantity, purchase cost, and date are required": "L'ingrédient, la quantité, le coût d'achat et la date sont obligatoires",
  "Quantity, purchase price, and date are required": "La quantité, le prix d'achat et la date sont obligatoires",
};

// Phrases with numbers or names inside — [pattern, French]
const FR_RULES = [
  [/^Refund request sent \((.+)\) — the Owner, or a manager allowed to give refunds, approves it in Requests$/, 'Demande de remboursement envoyée ($1) — le propriétaire, ou un gérant autorisé, l\'approuve dans Demandes'],
  [/^Message saved, but it could not be emailed yet: (.*)$/, 'Message enregistré, mais il n\'a pas encore pu être envoyé : $1'],
  [/^Still not delivered: (.*)$/, 'Toujours pas remis : $1'],
  [/^(.+) — (allowed|not allowed)$/, (m, a, b) => `${frText(a) || a} — ${b === 'allowed' ? 'autorisé' : 'non autorisé'}`],
  [/^(.+) \((\d+)\)$/, (m, a, b) => { const t = frText(a); return t ? `${t} (${b})` : m; }],
  [/^(.+) — (\d+) items?$/, '$1 — $2 article(s)'], [/^(.+) — Paid$/, '$1 — payée'],
  [/^From (.+) to (.+), the business sold (.+) worth of drinks and food in (\d+) orders?\. (.*)$/, (m, a, b, c, d, e) => `Du ${a} au ${b}, l'entreprise a vendu pour ${c} de boissons et de plats en ${d} commande(s). ${frText(e) || e}`],
  [/^After (.+) in discounts and (.+) in refunds, net sales were (.+?)\. That is ([\d.]+)% (less|more) than the previous period \((.+)\)\.$/, (m, a, b, c, p, w, d) => `Après ${a} de remises et ${b} de remboursements, les ventes nettes sont de ${c}, soit ${p} % de ${w === 'less' ? 'moins' : 'plus'} que la période précédente (${d}).`],
  [/^Net sales were (.+?)\. That is ([\d.]+)% (less|more) than the previous period \((.+)\)\.$/, (m, c, p, w, d) => `Les ventes nettes sont de ${c}, soit ${p} % de ${w === 'less' ? 'moins' : 'plus'} que la période précédente (${d}).`],
  [/^After expenses, the net operating profit is (.+) \(before tax\)\.$/, "Après les dépenses, le résultat d'exploitation est de $1 (avant impôt)."],
  [/^No operating expenses were recorded, so the net operating profit is also (.+) \(before tax\)\.$/, "Aucune charge d'exploitation n'a été enregistrée : le résultat d'exploitation est aussi de $1 (avant impôt)."],
  [/^The goods sold cost (.+), so the business kept (.+) as gross profit — (.+) of every franc sold\.$/, "Les marchandises vendues ont coûté $1 : l'entreprise a gardé $2 de marge brute — $3 de chaque franc vendu."],
  [/^Stock on hand is worth (.+) at purchase cost\. If all the drinks in stock sold at today's prices they would bring (.+) — (.+) of profit that is not earned yet\.$/, "Le stock disponible vaut $1 au prix d'achat. Si toutes les boissons en stock étaient vendues aux prix du jour, elles rapporteraient $2 — $3 de bénéfice pas encore gagné."],
  [/^(\d+) dish\(es\) have no recipe, so their ingredient cost and profit cannot be calculated\.$/, "$1 plat(s) sans recette : le coût des ingrédients et le bénéfice ne peuvent pas être calculés."],
  [/^(\d+) dish\(es\) have no recipe, so their ingredient cost is unknown and kitchen profit looks higher than it really is\. Add recipes in Kitchen → Recipes\.$/, "$1 plat(s) sans recette : le coût des ingrédients est inconnu et le bénéfice cuisine paraît plus élevé qu'en réalité. Ajoutez des recettes dans Cuisine → Recettes."],
  [/^(\d+) products? need attention \(sales falling, no sales in (\d+) days\)\.$/, "$1 produit(s) à surveiller (ventes en baisse, aucune vente depuis $2 jours)."],
  [/^(\d+) item\(s\) hold (.+) of stock that no record explains — a stock count settles this\.$/, "$1 article(s) représentent $2 de stock qu'aucun enregistrement n'explique — un inventaire règle cela."],
  [/^(\d+) item\(s\) in stock have no purchase cost and are not counted$/, "$1 article(s) en stock sans coût d'achat — non comptés"],
  [/^Current stock is (.+), but recorded movements add up to (.+) \(difference (.+)\)\. This happens when stock is typed in or edited without a purchase\/adjustment record, or when a sale was blocked from going below zero\.(.*)$/, "Le stock actuel est de $1, mais les mouvements enregistrés totalisent $2 (écart $3). Cela arrive quand le stock est saisi ou modifié sans achat/ajustement, ou quand une vente a été bloquée sous zéro.$4"],
  [/^Drinks earned (.+) of profit on (.+) of sales — (.+) of each sale was kept\.$/, "Les boissons ont rapporté $1 de bénéfice sur $2 de ventes — $3 de chaque vente conservés."],
  [/^If all drinks in stock were sold at today's prices, they would add (.+) of profit \(not earned yet\)\.$/, "Si toutes les boissons en stock étaient vendues aux prix du jour, elles ajouteraient $1 de bénéfice (pas encore gagné)."],
  [/^In total, the business currently owes suppliers (.+?)\.?$/, "Au total, l'entreprise doit actuellement $1 aux fournisseurs."],
  [/^Kitchen ingredients in stock are worth (.+?)\.?$/, "Les ingrédients cuisine en stock valent $1."],
  [/^Most money came by (.+) \((.+) of what was received\)\.$/, (m, a, b) => `La plupart de l'argent est venu par ${frText(a) || a} (${b} des encaissements).`],
  [/^Net sales (fell|rose) (.+) \((.+) vs (.+) in the previous period\)\.$/, (m, w, p, a, b) => `Les ventes nettes ont ${w === 'fell' ? 'baissé' : 'augmenté'} de ${p} (${a} contre ${b} sur la période précédente).`],
  [/^Overall, (.+) came in and (.+) went out \(net (.+)\), including owner withdrawals, capital and loans, which never count as profit\.$/, "Au total, $1 sont entrés et $2 sont sortis (net $3), y compris retraits du propriétaire, capital et prêts, qui ne comptent jamais comme bénéfice."],
  [/^(.+) of stock was bought in (\d+) deliver(?:y|ies) from (\d+) supplier\(s\)\. (.+) was paid on delivery and (.+) was left unpaid\.$/, "$1 de stock acheté en $2 livraison(s) chez $3 fournisseur(s). $4 payés à la livraison et $5 restés impayés."],
  [/^(.+) of stock is tied up in (\d+) product\(s\) with no sales in (\d+) days\.$/, "$1 de stock immobilisé dans $2 produit(s) sans vente depuis $3 jours."],
  [/^(.+) of stock value is not explained by recorded stock movements\.$/, "$1 de valeur de stock non expliqués par les mouvements enregistrés."],
  [/^The best-selling item was (.+) \((\d+) sold, (.+)\)\.$/, "L'article le plus vendu : $1 ($2 vendus, $3)."],
  [/^The biggest supplier was (.+) \((.+)\)\.$/, (m, a, b) => `Le plus gros fournisseur : ${frText(a) || a} (${b}).`],
  [/^The most profitable drink was (.+): (.+) from (\d+) sold\.$/, "La boisson la plus rentable : $1 — $2 pour $3 vendus."],
  [/^Selling all the drinks at today's prices would bring (.+), which is (.+) more than they cost — profit not earned yet\.$/, "Vendre toutes les boissons aux prix du jour rapporterait $1, soit $2 de plus que leur coût — bénéfice pas encore gagné."],
  [/^Records made before stage 2 \((.+)\) have no discount, shift, expense payment method or supplier payment details\.$/, "Les enregistrements antérieurs à l'étape 2 ($1) n'ont ni remise, ni service, ni moyen de paiement des dépenses, ni paiement fournisseur."],
  [/^Counts are due every (\d+) days \(set by the Owner in Settings\)\. No count has been recorded yet\. A count confirms the stock figures and settles unexplained differences\.$/, "Un inventaire est dû tous les $1 jours (réglé par le propriétaire dans Paramètres). Aucun inventaire n'a encore été fait. Un inventaire confirme les chiffres du stock et règle les écarts inexpliqués."],
  [/^Local data is automatically deleted after (\d+) days\. Full history is always available online from the server\.$/, "Les données locales sont supprimées automatiquement après $1 jours. L'historique complet reste disponible en ligne sur le serveur."],
  [/^(\d+) orders? brought in (.+); after (.+) of discounts and refunds, net sales were (.+?)\.?$/, "$1 commande(s) ont rapporté $2 ; après $3 de remises et remboursements, les ventes nettes sont de $4."],
  [/^(\d+) older purchase\(s\) with no payment record — treated as paid$/, "$1 ancien(s) achat(s) sans paiement enregistré — considéré(s) payé(s)"],
  [/^(.+) each · (\d+) of (\d+) refundable$/, "$1 l'unité · $2 sur $3 remboursable(s)"],
  [/^(.+) in stock but cost per unit is 0, so its value and profit cannot be calculated\.$/, "$1 en stock mais le coût unitaire est 0 : sa valeur et son bénéfice ne peuvent pas être calculés."],
  [/^(\d+)x (.+) \(back in stock\)$/, '$1x $2 (remis en stock)'], [/^No sales in (\d+) days$/, 'Aucune vente depuis $1 jours'],
  [/^every (\d+) days$/, 'tous les $1 jours'],
  [/^(\d[\d,.]*) items?$/, '$1 article(s)'], [/^(\d[\d,.]*) item\(s\)$/, '$1 article(s)'], [/^· (\d+) items?$/, '· $1 article(s)'],
  [/^(\d[\d,.]*) in stock$/, '$1 en stock'], [/^(\d[\d,.]*) orders?$/, '$1 commande(s)'], [/^(\d[\d,.]*) units?$/, '$1 unité(s)'],
  [/^(\d[\d,.]*) units sold$/, '$1 unités vendues'], [/^(\d[\d,.]*) sales? recorded$/, '$1 vente(s) enregistrée(s)'], [/^(\d[\d,.]*) deliveries$/, '$1 livraisons'],
  [/^(\d[\d,.]*) portions$/, '$1 portions'], [/^(\d[\d,.]*) paid$/, '$1 payé(s)'], [/^(\d[\d,.]*) unpaid$/, '$1 impayé(s)'], [/^(\d[\d,.]*) refunded$/, '$1 remboursé(s)'],
  [/^(\d[\d,.]*) records$/, '$1 enregistrements'], [/^(\d[\d,.]*) entries$/, '$1 entrées'], [/^(\d[\d,.]*) days?$/, '$1 jour(s)'], [/^(\d[\d,.]*) seats$/, '$1 places'],
  [/^(\d+) low · (\d+) out$/, '$1 bas · $2 épuisé(s)'], [/^(\d+) of (\d+)$/, '$1 sur $2'], [/^(\d+) points? need review\.$/, '$1 point(s) à vérifier.'],
  [/^([\d.]+)% margin$/, 'marge $1%'], [/^([\d.]+)% of sales kept$/, '$1% des ventes conservées'], [/^([\d.]+)% of selling price$/, '$1% du prix de vente'],
  [/^\+?(\d+) min late$/, '$1 min de retard'], [/^(\d+) min left$/, '$1 min restantes'], [/^Est\. (\d+) min$/, 'Est. $1 min'],
  [/^Last (\d+) sales today$/, '$1 dernières ventes du jour'], [/^This month so far: (.+)$/, 'Ce mois jusqu\'ici : $1'], [/^Updated (.+)$/, 'Mis à jour $1'],
  [/^Live · updated (.+)$/, 'En direct · mis à jour $1'], [/^Good (morning|afternoon|evening), (.+)$/, (m, p, n) => `${{ morning: 'Bonjour', afternoon: 'Bon après-midi', evening: 'Bonsoir' }[p]}, ${n}`],
  [/^Welcome, (.+)$/, 'Bienvenue, $1'], [/^Dine-in · (.+)$/, 'Sur place · $1'], [/^Takeaway · (.+)$/, 'À emporter · $1'], [/^Table: (.+)$/, 'Table : $1'],
  [/^Order (\S+) created$/, 'Commande $1 créée'], [/^(.+) is out of stock$/, '$1 est épuisé'], [/^Only (\d+) (.+) left in stock$/, 'Plus que $1 $2 en stock'],
  [/^No more (.+) in stock$/, 'Plus de $1 en stock'], [/^Monthly Sales — Last (\d+) Months$/, 'Ventes mensuelles — $1 derniers mois'],
  [/^Last (\d+) months · hover a month to compare$/, '$1 derniers mois · survolez un mois pour comparer'],
  [/^Last (\d+) paid orders — open one to request a void or refund$/, '$1 dernières commandes payées — ouvrez-en une pour demander une annulation ou un remboursement'],
  [/^(\d+) item\(s\) are running low and (\d+) are out of stock\.$/, '$1 article(s) bientôt épuisé(s) et $2 épuisé(s).'],
  [/^(.+) earned the most gross profit: (.+) from (\d+) sold\.$/, '$1 a rapporté la plus forte marge : $2 pour $3 vendus.'],
  [/^Stock on hand is worth (.+) at purchase cost\.$/, 'Le stock disponible vaut $1 au prix d\'achat.'],
  [/^Money actually received was (.+?)\.?$/, 'Argent réellement reçu : $1.'], [/^The business owes suppliers (.+?)\.?$/, 'L\'entreprise doit $1 aux fournisseurs.'],
  [/^Next count in (\d+) day\(s\)$/, 'Prochain inventaire dans $1 jour(s)'], [/^Every (\d+) weeks$/, 'Toutes les $1 semaines'],
  [/^Previous period: (.+) → (.+)$/, 'Période précédente : $1 → $2'], [/^(.+) possibly affected$/, '$1 peut-être concerné(s)'],
  [/^(.+) discounts · (.+) refunds$/, '$1 remises · $2 remboursements'], [/^(.+) in · (.+) out$/, '$1 entrées · $2 sorties'], [/^could sell for (.+)$/, 'pourrait se vendre $1'],
  [/^Refund request sent to the Owner \((.+)\)$/, 'Demande de remboursement envoyée au propriétaire ($1)'], [/^Refunded (RWF [\d,.]+)$/, 'Remboursé $1'],
  [/^Stock received — spent (.+)$/, 'Stock réceptionné — dépense $1'], [/^Now working in: (.+)$/, 'Travail sur : $1'],
  [/^You have (\d+) pending void requests? awaiting your review$/, 'Vous avez $1 demande(s) d\'annulation en attente'],
  [/^(\d+) void requests? pending review$/, '$1 demande(s) d\'annulation en attente'], [/^(\d+) products? low on stock$/, '$1 produit(s) en stock bas'],
  [/^New order #(\S+) \((.*)\): (.*)$/, 'Nouvelle commande #$1 ($2) : $3'], [/^Remove "(.+)"\?$/, 'Retirer « $1 » ?'], [/^"(.+)" removed$/, '« $1 » retiré'],
  [/^Kitchen has not served this order yet \((.+), (.+)\)\. Payment opens once food is served\.$/, 'La cuisine n\'a pas encore servi cette commande ($1, $2). Le paiement s\'ouvre une fois les plats servis.'],
  [/^Today · (.+) · generated (.+)$/, 'Aujourd\'hui · $1 · généré $2'], [/^Auto · (.+)$/, (m, t) => `Auto · ${frText(t) || t}`],
  [/^(.+) \(illustration\)$/, (m, t) => `${frText(t) || t} (illustration)`], [/^(.+) — illustration; upload a real photo to replace$/, (m, t) => `${frText(t) || t} — illustration ; ajoutez une vraie photo pour la remplacer`],
  [/^Reject order #(.+)$/, 'Refuser la commande #$1'], [/^Accept Order #(.+)$/, 'Accepter la commande #$1'], [/^(.+) — Costing$/, '$1 — coûts'],
  [/^Receive Stock — (.+)$/, 'Réceptionner du stock — $1'], [/^(\d+) abantu$/, '$1 abantu'], [/^Limit: (\d+) days$/, 'Limite : $1 jours'], [/^Min (\d+) characters$/, 'Min. $1 caractères'],
  [/^(.+): stock not explained by movement records$/, '$1 : stock non expliqué par les mouvements'], [/^(.+): in stock without a purchase cost$/, '$1 : en stock sans coût d\'achat'],
  [/^Supplier: (.+)$/, 'Fournisseur : $1'], [/^Device: (.+)$/, 'Appareil : $1'], [/^Stock count due every (\d+) days?$/, 'Inventaire tous les $1 jour(s)'],
  [/^(.+)\((.+) · (Owner|Manager|Bartender|Kitchen)\)$/, (m, a, b, r) => `${a}(${b} · ${frText(r) || r})`],
  // A · B · C — translate each part on its own
  [/^(.+ · .+)$/, m => { let hit = false; const out = m.split(' · ').map(p => { const t = frText(p); if (t && t !== p) { hit = true; return t; } return p; }); return hit ? out.join(' · ') : m; }],
];

// ── engine ─────────────────────────────────────────
const _frMap = new Map(Object.entries(FR_DICT).map(([k, v]) => [k.trim().toLowerCase(), v]));
const _FR_EDGE = /^([\s+✓✕←→•·=\-–—#]*)(.*?)([\s:*…!.]*)$/u;

function frText(raw) {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s || !/[A-Za-z]/.test(s)) return null;
  let v = _frMap.get(s.toLowerCase());
  let pre = '', post = '';
  if (v === undefined) {
    const m = s.match(_FR_EDGE);
    if (m && m[2] && (m[1] || m[3])) { v = _frMap.get(m[2].toLowerCase()); pre = m[1]; post = m[3]; }
  }
  if (v === undefined) {
    for (const [re, rep] of FR_RULES) { if (re.test(s)) return s.replace(re, rep); }
    return null;
  }
  const core = pre || post ? s.slice(pre.length, s.length - post.length) : s;
  if (core === core.toUpperCase() && /[A-Z]{2}/.test(core)) v = v.toUpperCase();
  else if (/^[A-Z]/.test(core) && /^[a-zà-ÿ]/.test(v)) v = v[0].toUpperCase() + v.slice(1);
  return pre + v + post;
}

const FR_ATTRS = ['placeholder', 'title', 'aria-label'];
const FR_SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);
function _frSkip(el) { return !el || FR_SKIP.has(el.tagName) || !!el.closest('[data-no-fr]'); }

function frTranslateNode(root) {
  if (!root) return;
  if (root.nodeType === 3) { _frTextNode(root); return; }
  if (root.nodeType !== 1 || _frSkip(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; const list = [];
  while ((n = w.nextNode())) list.push(n);
  list.forEach(_frTextNode);
  const els = root.querySelectorAll ? [root, ...root.querySelectorAll('[placeholder],[title],[aria-label]')] : [root];
  els.forEach(el => {
    if (!el.getAttribute || (el.tagName !== 'TEXTAREA' && _frSkip(el))) return;
    FR_ATTRS.forEach(a => {
      const v = el.getAttribute(a);
      if (!v) return;
      el.__frAttr = el.__frAttr || {};
      if (el.__frAttr[a] && el.__frAttr[a].fr === v) return;
      const t = frText(v);
      if (t && t !== v) { el.__frAttr[a] = { en: v, fr: t }; el.setAttribute(a, t); }
    });
  });
}
function _frTextNode(n) {
  if (_frSkip(n.parentElement)) return;
  const v = n.nodeValue;
  if (n.__fr !== undefined && n.__fr === v) return;   // already ours
  const t = frText(v);
  if (t && t !== v.trim()) {
    const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
    n.__en = v; n.__fr = lead + t + trail;
    n.nodeValue = n.__fr;
  }
}
function frRestore() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) { if (n.__en !== undefined && n.nodeValue === n.__fr) n.nodeValue = n.__en; delete n.__en; delete n.__fr; }
  document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el => {
    if (!el.__frAttr) return;
    Object.entries(el.__frAttr).forEach(([a, o]) => { if (el.getAttribute(a) === o.fr) el.setAttribute(a, o.en); });
    delete el.__frAttr;
  });
}

let _frObs = null, _frQueue = new Set(), _frScheduled = false;
function _frQueueRecords(muts) {
  muts.forEach(m => {
    if (m.type === 'childList') m.addedNodes.forEach(x => _frQueue.add(x));
    else _frQueue.add(m.target);
  });
}
function _frFlush() {
  _frScheduled = false;
  // pick up changes not yet delivered — disconnect() would throw them away
  if (_frObs) { _frQueueRecords(_frObs.takeRecords()); _frObs.disconnect(); }
  const q = [..._frQueue]; _frQueue.clear();
  try { q.forEach(frTranslateNode); }
  finally { if (_frObs && currentLang === 'fr') _frObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: FR_ATTRS }); }
}
function frStart() {
  if (!_frObs) {
    _frObs = new MutationObserver(muts => {
      _frQueueRecords(muts);
      if (!_frScheduled) { _frScheduled = true; queueMicrotask(_frFlush); }
    });
  }
  frTranslateNode(document.body);
  _frObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: FR_ATTRS });
  document.documentElement.lang = 'fr';
}
function frStop() {
  if (_frObs) _frObs.disconnect();
  _frQueue.clear();
  frRestore();
  document.documentElement.lang = 'en';
}
function frSync() { (typeof currentLang !== 'undefined' && currentLang === 'fr') ? frStart() : frStop(); }

// browser dialogs (confirm / alert) also speak French
(function () {
  const _c = window.confirm.bind(window), _a = window.alert.bind(window);
  const tr = m => (typeof currentLang !== 'undefined' && currentLang === 'fr') ? (frText(String(m)) || String(m)) : m;
  window.confirm = m => _c(tr(m));
  window.alert = m => _a(tr(m));
})();

// hook the existing language switch
if (typeof applyLanguage === 'function') {
  const _frApply = applyLanguage;
  applyLanguage = function () {
    const r = _frApply.apply(this, arguments);
    // the top-bar title only changed on navigation before — update it now
    const act = document.querySelector('.page.active'), pt = document.getElementById('pageTitle');
    if (act && pt && typeof PAGE_TITLES !== 'undefined') {
      const id = act.id.replace('page-', '');
      pt.textContent = (PAGE_TITLES[currentLang] || PAGE_TITLES.en)[id] || PAGE_TITLES.en[id] || pt.textContent;
    }
    frSync();
    if (typeof uiApplyTheme === 'function') uiApplyTheme(uiTheme());
    return r;
  };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', frSync); else frSync();
