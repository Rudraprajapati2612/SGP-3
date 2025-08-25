// Central place to update after redeploys
export const CONTRACTS = {
  factory: "0xdCFfB4215ADD9E1D4197a672aD7B5d57F83C6778",
  router: "0x8b12B25cd341920c3A8928BC1bfC07BEc0aA8EA7",
  tokens: {
    TETH: "0xB12135E48994087a925b0DdeC7E99CBe631DBD49",
    TUSDC: "0x5921BCB320A90f57750f5c1Bde96890C7D0dD5CD",
    TUSDT: "0x188eE29bD4Ea836dE395da0713c13C91aC087088",
    ALP: "0xA1B8ce0eF14dFBaB865F6f58954e592A1261DAb3",
    SUP : "0x048d7F61FCD5684B797fa5267A9451573cDd5092",
  },
} as const

export const TOKEN_LIST = Object.entries(CONTRACTS.tokens).map(([symbol, address]) => ({
  symbol,
  address,
}))
