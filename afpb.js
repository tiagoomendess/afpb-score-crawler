const axios = require('axios')
const cheerio = require('cheerio')
const config = require('./config.json')

const DIV_1_EDITION = 49
const DIV_2_A_EDITION = 50
const DIV_2_B_EDITION = 51
const TACA_EDITION = 48

const competitionToEdition = {
    "1ª Divisão AGRIBAR Campeonato": DIV_1_EDITION,
    "2ª Divisão AFPB Série A": DIV_2_A_EDITION,
    "2ª Divisão AFPB Série B": DIV_2_B_EDITION,
    "Taça Cidade de Barcelos Eliminatórias": TACA_EDITION,
}

const CSS_SELECTORS = {
    GAMES: 'div.games > .overview',
    HOME_TEAM_NAME: '.teams > .home-team > .team-name',
    AWAY_TEAM_NAME: '.teams > .away-team > .team-name',
    HOME_SCORE: '.score-home',
    AWAY_SCORE: '.score-away',
    DATE: 'time',
    WIN: '.teams > .win'
}

const handleGroup = async (gameGroup) => {
    const edition = competitionToEdition[`${gameGroup.competition_name} ${gameGroup.game_group_name}`]
    if (!edition) {
        console.log(`No edition found for competition ${gameGroup.competition_name} ${gameGroup.game_group_name}`)
        return []
    }

    // The gamegroup has an array of games, but those games can have different rounds, 
    // get all the possible int values for round from all the items inside group.games
    // distinct round values
    const rounds = gameGroup.games.map(game => game.round).filter(round => round !== null).map(round => parseInt(round)).filter((round, index, self) => self.indexOf(round) === index)

    // for each round make one request to a website to scrape and save the results in an array of values
    // The response will be HTML, so we need to use cheerio to parse the response
    const responses = []
    for (const round of rounds) {
        // Turns out ordering can be dephased by the edition
        let ordering = null
        switch (edition) {
            case TACA_EDITION:
                ordering = round + 2
                break
            default:
                ordering = round
        }

        const requestUrl = `https://afpbarcelos.pt/index.php?partial_load=_constructhtmlbyedition&edition=${edition}&ordering=${ordering}`

        console.log(`Requesting ${requestUrl}`)

        // Wait a random time between 500 and 1000ms so we don't overload the server
        const randomTime = Math.floor(Math.random() * 500) + 500
        await new Promise(resolve => setTimeout(resolve, randomTime))

        const response = await axios.get(requestUrl, {
            headers: generateRandomHeaders(),
            timeout: 10000,
            withCredentials: true
        })
        if (response.status !== 200) {
            console.log(`Error making request to ${requestUrl}, status: ${response.status}`)
            continue
        }

        responses.push(response.data)
    }

    const games = []
    for (const response of responses) {
        const $ = cheerio.load(response)
        
        $(CSS_SELECTORS.GAMES).each((i, element) => {
            const homeTeam = $(element).find(CSS_SELECTORS.HOME_TEAM_NAME).text().trim()
            const awayTeam = $(element).find(CSS_SELECTORS.AWAY_TEAM_NAME).text().trim()
            const homeScore = $(element).find(CSS_SELECTORS.HOME_SCORE).text().trim()
            const awayScore = $(element).find(CSS_SELECTORS.AWAY_SCORE).text().trim()
            const dateStr = $(element).find(CSS_SELECTORS.DATE).text().trim()

            // if an element inside this game has the class win, then the game is finished
            const finished = $(element).find(CSS_SELECTORS.WIN).length > 0

            // date is only in format DD/MM HH:MM, use current year. The time is Europe/Lisbon
            const splitted = dateStr.split(' ')
            const [day, month] = splitted[0].split('/').map(x => parseInt(x, 10))
            const [hour, minute] = splitted[1].split(':').map(x => parseInt(x, 10))
            const year = new Date().getFullYear()
            
            // Create date (month is 0-indexed in JS)
            const date = new Date(year, month - 1, day, hour, minute)

            games.push({
                homeTeam: mapClubName(homeTeam),
                awayTeam: mapClubName(awayTeam),
                homeScore: homeScore ? parseInt(homeScore, 10) : null,
                awayScore: awayScore ? parseInt(awayScore, 10) : null,
                finished: finished,
                date: date.toISOString()
            })
        })
    }

    console.log(`Extracted ${games.length} games from edition ${edition}`)

    return games
}

const mapClubName = (name) => {
    if (!config.club_names_map) {
        console.warn('No club names map found in config')
        return name
    }

    const map = config.club_names_map
    const length = map.length
    for (let i = 0; i < length; i++) {
        if (map[i].from === name) {
            return map[i].to
        }
    }

    console.warn(`No mapping found for club ${name}`)

    return name
}

const generateRandomHeaders = () => {
    // Random User Agents
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]

    // Random Accept-Language combinations
    const languages = [
        'pt-PT,pt;q=0.9,en;q=0.8',
        'pt-BR,pt;q=0.9,en;q=0.8',
        'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'en-US,en;q=0.9,pt;q=0.8',
        'en-GB,en;q=0.9,pt;q=0.8'
    ]

    // Random Accept headers
    const accepts = [
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    ]

    // Generate random cookie values
    const generateRandomId = () => Math.floor(Math.random() * 1000000000) + 1000000000
    const generateRandomTimestamp = () => Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 86400 * 30) // Random time in last 30 days

    const gaId = generateRandomId()
    const gidId = generateRandomId()
    const fbpId = generateRandomTimestamp()
    const gaTimestamp = generateRandomTimestamp()
    const gidTimestamp = generateRandomTimestamp()

    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Accept': accepts[Math.floor(Math.random() * accepts.length)],
        'Accept-Language': languages[Math.floor(Math.random() * languages.length)],
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': Math.random() > 0.5 ? '1' : '0', // Randomly include DNT
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': Math.random() > 0.3 ? 'max-age=0' : 'no-cache', // Sometimes vary cache control
        'Cookie': `_ga=GA1.2.${gaId}.${gaTimestamp}; _gid=GA1.2.${gidId}.${gidTimestamp}; _fbp=fb.1.${fbpId}.${gaTimestamp}`
    }
}

module.exports = {
    handleGroup
}
