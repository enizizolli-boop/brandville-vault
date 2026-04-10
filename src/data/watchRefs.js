// Curated reference → model name lookup for common luxury watches
// This map is used by the Quick Post parser to auto-fill model names
const WATCH_REFS = {
  // Rolex
  '116500LN': 'Daytona', '116503': 'Daytona', '116508': 'Daytona', '116509': 'Daytona', '116515LN': 'Daytona', '116518LN': 'Daytona', '116519LN': 'Daytona', '116520': 'Daytona', '126500LN': 'Daytona',
  '116610LN': 'Submariner', '116610LV': 'Submariner', '116613LB': 'Submariner', '116613LN': 'Submariner', '116618LB': 'Submariner', '116619LB': 'Submariner', '114060': 'Submariner', '124060': 'Submariner', '126610LN': 'Submariner', '126610LV': 'Submariner', '126613LB': 'Submariner', '126619LB': 'Submariner',
  '126710BLNR': 'GMT-Master II', '126710BLRO': 'GMT-Master II', '126711CHNR': 'GMT-Master II', '126715CHNR': 'GMT-Master II', '126720VTNR': 'GMT-Master II', '116710LN': 'GMT-Master II', '116710BLNR': 'GMT-Master II', '116713LN': 'GMT-Master II', '116718LN': 'GMT-Master II',
  '126334': 'Datejust 41', '126331': 'Datejust 41', '126333': 'Datejust 41', '126300': 'Datejust 41', '126301': 'Datejust 41',
  '126234': 'Datejust 36', '126231': 'Datejust 36', '126233': 'Datejust 36', '126200': 'Datejust 36', '126281RBR': 'Datejust 36', '126284RBR': 'Datejust 36',
  '126138': 'Datejust 36', '126158': 'Datejust 36', '126183': 'Datejust 36', '126203': 'Datejust 36',
  '278274': 'Datejust 31', '278271': 'Datejust 31', '278273': 'Datejust 31', '278240': 'Datejust 31', '278344RBR': 'Datejust 31', '278278': 'Datejust 31', '278288RBR': 'Datejust 31',
  '228235': 'Day-Date 40', '228238': 'Day-Date 40', '228239': 'Day-Date 40', '228206': 'Day-Date 40', '228349RBR': 'Day-Date 40',
  '226570': 'Explorer II', '216570': 'Explorer II', '124270': 'Explorer', '214270': 'Explorer',
  '326934': 'Sky-Dweller', '326933': 'Sky-Dweller', '326935': 'Sky-Dweller', '326938': 'Sky-Dweller',
  '126660': 'Sea-Dweller Deepsea', '126600': 'Sea-Dweller', '136660': 'Sea-Dweller Deepsea',
  '116681': 'Yacht-Master II', '116680': 'Yacht-Master II', '126621': 'Yacht-Master 40', '126622': 'Yacht-Master 40', '226659': 'Yacht-Master 42',
  '116506': 'Daytona Platinum', '116505': 'Daytona Everose', '126506': 'Daytona Platinum',
  '126518LN': 'Daytona', '126518': 'Daytona', '126519LN': 'Daytona', '126529LN': 'Daytona',
  '3135': 'Air-King', '126900': 'Air-King', '116900': 'Air-King',
  '5513': 'Submariner Vintage', '5512': 'Submariner Vintage', '1680': 'Submariner Vintage', '16610': 'Submariner', '16710': 'GMT-Master II', '16613': 'Submariner', '16600': 'Sea-Dweller',
  '228236': 'Day-Date 40', '118239': 'Day-Date 36', '118238': 'Day-Date 36',

  // Audemars Piguet
  '15500ST': 'Royal Oak', '15510ST': 'Royal Oak', '15400ST': 'Royal Oak', '15202ST': 'Royal Oak Jumbo', '15202IP': 'Royal Oak Jumbo', '16202ST': 'Royal Oak Jumbo',
  '15300ST': 'Royal Oak', '15450ST': 'Royal Oak 37mm', '15550ST': 'Royal Oak', '15500OR': 'Royal Oak',
  '26331ST': 'Royal Oak Chronograph', '26315ST': 'Royal Oak Chronograph', '26240ST': 'Royal Oak Chronograph', '26239BC': 'Royal Oak Chronograph',
  '15710ST': 'Royal Oak Offshore Diver', '15703ST': 'Royal Oak Offshore', '26470ST': 'Royal Oak Offshore Chronograph', '26400IO': 'Royal Oak Offshore', '26238TI': 'Royal Oak Offshore',
  '26170ST': 'Royal Oak Offshore Chronograph', '15400OR': 'Royal Oak', '15500TI': 'Royal Oak',
  '26120ST': 'Royal Oak Dual Time', '26574ST': 'Royal Oak Perpetual Calendar',
  '77350ST': 'Royal Oak 34mm', '15451ST': 'Royal Oak 37mm',

  // Patek Philippe
  '5711': 'Nautilus', '5711/1A': 'Nautilus', '5711/1R': 'Nautilus', '5712': 'Nautilus', '5712/1A': 'Nautilus',
  '5726': 'Nautilus Annual Calendar', '5726/1A': 'Nautilus Annual Calendar', '5740': 'Nautilus Perpetual Calendar',
  '5980': 'Nautilus Chronograph', '5980/1A': 'Nautilus Chronograph', '5990': 'Nautilus Travel Time', '5990/1A': 'Nautilus Travel Time',
  '5164A': 'Aquanaut Travel Time', '5164R': 'Aquanaut Travel Time', '5167A': 'Aquanaut', '5167R': 'Aquanaut', '5168G': 'Aquanaut',
  '5196': 'Calatrava', '5196G': 'Calatrava', '5196R': 'Calatrava', '5227': 'Calatrava', '5227G': 'Calatrava', '5227R': 'Calatrava',
  '5905': 'Annual Calendar Chronograph', '5905/1A': 'Annual Calendar Chronograph',
  '5146': 'Annual Calendar', '5146G': 'Annual Calendar', '5146R': 'Annual Calendar',
  '5270': 'Perpetual Calendar Chronograph', '5270G': 'Perpetual Calendar Chronograph',
  '5320G': 'Perpetual Calendar', '5327': 'Perpetual Calendar',
  '5070': 'Chronograph', '5070G': 'Chronograph',
  '5100': 'Gondolo', '5100G': 'Gondolo', '5100J': 'Gondolo', '5100P': 'Gondolo',
  '5524': 'Calatrava Pilot Travel Time', '5524G': 'Calatrava Pilot Travel Time',

  // Omega
  '310.30.42.50.01.001': 'Speedmaster Moonwatch', '311.30.42.30.01.005': 'Speedmaster Professional',
  '310.30.42.50.01.002': 'Speedmaster Moonwatch', '311.30.42.30.01.006': 'Speedmaster Professional',
  '210.30.42.20.01.001': 'Seamaster 300M', '210.30.42.20.03.001': 'Seamaster 300M',
  '210.30.42.20.06.001': 'Seamaster 300M', '210.22.42.20.01.001': 'Seamaster 300M',
  '210.90.42.20.01.001': 'Seamaster 300M', '210.32.42.20.01.001': 'Seamaster 300M',
  '220.10.41.21.01.001': 'Seamaster Aqua Terra', '220.10.41.21.03.001': 'Seamaster Aqua Terra',
  '220.10.38.20.01.001': 'Seamaster Aqua Terra 38mm',
  '232.30.42.21.01.001': 'Seamaster Planet Ocean', '215.30.44.21.01.001': 'Seamaster Planet Ocean',
  '131.33.41.21.01.001': 'Constellation', '131.33.41.21.03.001': 'Constellation',
  '326.30.40.50.01.001': 'Speedmaster Racing', '329.30.44.51.01.001': 'Speedmaster Racing',
  '310.10.38.20.03.005': 'Speedmaster 38mm', '324.30.38.50.01.001': 'Speedmaster 38mm',

  // IWC
  'IW500710': 'Portugieser Automatic', 'IW500714': 'Portugieser Automatic', 'IW371605': 'Portugieser Chronograph', 'IW371615': 'Portugieser Chronograph',
  'IW390701': 'Portugieser Yacht Club Chronograph', 'IW503312': 'Portugieser Perpetual Calendar',
  'IW328802': 'Big Pilot', 'IW329303': "Big Pilot's Watch 43", 'IW388101': 'Pilot Chronograph', 'IW388103': 'Pilot Chronograph',
  'IW510103': 'Portofino', 'IW356501': 'Portofino Automatic',

  // Jaeger-LeCoultre
  'Q1368420': 'Master Ultra Thin Moon', 'Q1362520': 'Master Ultra Thin', 'Q1548420': 'Master Control Date',
  'Q3838420': 'Reverso Classic', 'Q2588120': 'Reverso Tribute', 'Q3978480': 'Reverso Classic Medium',
  'Q9068670': 'Polaris Chronograph', 'Q9038180': 'Polaris',

  // Vacheron Constantin
  '4500V': 'Overseas', '47040': 'Overseas Chronograph', '5500V': 'Overseas',
  '2000V': 'Overseas Small', '85515': 'Patrimony', '81180': 'Patrimony',
  '43175': 'Traditionnelle', '82172': 'Traditionnelle Chronograph',
  '7900V': 'Overseas Ultra-Thin Perpetual Calendar',

  // Panerai
  'PAM01312': 'Luminor Marina', 'PAM01392': 'Luminor Due', 'PAM01537': 'Submersible',
  'PAM00904': 'Luminor Marina', 'PAM01029': 'Submersible', 'PAM01305': 'Luminor Base',
  'PAM00111': 'Luminor Marina', 'PAM00510': 'Luminor Marina 8 Days',

  // Tudor
  '79230N': 'Black Bay', '79230B': 'Black Bay', '79230R': 'Black Bay', '79360N': 'Black Bay Chrono',
  '79500': 'Black Bay 36', '79540': 'Black Bay 41', '79830RB': 'Black Bay GMT',
  '25600TN': 'Pelagos', '25610TNL': 'Pelagos', '79220R': 'Heritage Black Bay',
  'M79360N': 'Black Bay Chrono', 'M79230N': 'Black Bay',

  // Hublot
  '411.NM.1170.RX': 'Big Bang Unico', '441.NM.1170.RX': 'Big Bang Unico 42mm',
  '521.NX.1171.RX': 'Classic Fusion', '542.NX.1171.RX': 'Classic Fusion 42mm',
  '601.NX.0173.LR': 'Spirit of Big Bang',

  // Breitling
  'A17375': 'Superocean Heritage', 'A17376': 'Superocean Heritage II', 'AB0127': 'Navitimer', 'AB0121': 'Navitimer',
  'A13314': 'Chronomat', 'AB2010': 'Chronomat', 'A17325': 'Superocean',
  'UB0127': 'Navitimer', 'RB0121': 'Navitimer',

  // TAG Heuer
  'CBN2A1B': 'Monaco', 'CAR2A1Z': 'Carrera', 'WAZ2011': 'Formula 1', 'WBP201A': 'Aquaracer',
  'CBG2A1Z': 'Carrera Heuer 02', 'CBS2210': 'Monaco',

  // Zenith
  '03.3100.3600': 'Chronomaster Sport', '03.2040.4061': 'El Primero', '03.3100.3600/69': 'Chronomaster Sport',
  '03.2150.400': 'Chronomaster Open', '95.9003.9004': 'Defy El Primero 21',

  // Richard Mille
  'RM11': 'RM 11 Flyback Chronograph', 'RM35': 'RM 35 Rafael Nadal', 'RM55': 'RM 55',
  'RM67': 'RM 67 Automatic', 'RM72': 'RM 72 Flyback Chronograph', 'RM010': 'RM 010',

  // Cartier
  'WSSA0018': 'Santos de Cartier', 'WSSA0029': 'Santos de Cartier', 'WSSA0030': 'Santos de Cartier',
  'WSBB0015': 'Ballon Bleu', 'WSBB0039': 'Ballon Bleu', 'WSBB0040': 'Ballon Bleu',
  'WGTA0075': 'Tank Française', 'WSTA0065': 'Tank Must', 'CRWSPA0040': 'Pasha',

  // Blancpain
  '5000-0130': 'Fifty Fathoms', '5015-1130': 'Fifty Fathoms Bathyscaphe',
  '6654-1127': 'Villeret', '5015-11C30-52A': 'Fifty Fathoms',

  // Breguet
  '5177BR': 'Classique', '5517BR': 'Marine', '7787BR': 'Tradition',
  '5177BA': 'Classique', '3810ST': 'Type XX',

  // Grand Seiko
  'SBGA211': 'Spring Drive Snowflake', 'SBGA413': 'Spring Drive', 'SBGH267': 'Heritage Hi-Beat',
  'SBGW231': 'Elegance', 'SLGA007': 'Evolution 9',

  // Chopard
  '158571-3001': 'Mille Miglia', '278559-3001': 'Happy Sport', '161293-5001': 'L.U.C',

  // Piaget
  'G0A45502': 'Polo', 'G0A41112': 'Altiplano', 'G0A46018': 'Polo Date',

  // A. Lange & Söhne
  '191.032': 'Lange 1', '320.032': 'Saxonia', '722.048': 'Odysseus',
  '101.032': 'Lange 1', '191.039': 'Lange 1',

  // Ulysse Nardin
  '1183-170': 'Marine Chronometer', '3203-136': 'Diver', '2303-270': 'Freak',
}

export default WATCH_REFS
