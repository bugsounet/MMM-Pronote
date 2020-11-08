const pronote = require('@bugsounet/pronote-api');
const npmCheck = require("@bugsounet/npmcheck");
const wget = require('wget-improved');
const fs = require('fs');
const NodeHelper = require("node_helper");

let log = (...args) => { /* do nothing */ }

module.exports = NodeHelper.create({
   start: function() {
    /** initialize all value there **/
    this.session = []
    this.Checker = null
    this.student = 0
    this.account = {}
    this.cache = []
    this.accountNumber = 1
    this.currentDisplay = 1
    this.intervalUpdate = null
    this.intervalDisplay = null
    this.init = false
  },

  initialize: function(config) {
    console.log("[PRONOTE] MMM-Pronote Version:", require('./package.json').version)
    this.config = config
    if (this.config.debug) log = (...args) => { console.log("[PRONOTE]", ...args) }
    this.updateIntervalMilliseconds = this.getUpdateIntervalMillisecondFromString(this.config.updateInterval)
    this.displayIntervalMilliseconds = this.getUpdateIntervalMillisecondFromString(this.config.rotateInterval)
    /** check if update of npm Library needed **/
    if (this.config.NPMCheck.useChecker) {
      var cfg = {
        dirName: __dirname,
        moduleName: this.name,
        timer: this.getUpdateIntervalMillisecondFromString(this.config.NPMCheck.delay),
        debug: this.config.debug
      }
      this.Checker= new npmCheck(cfg, update => { this.sendSocketNotification("NPM_UPDATE", update)} )
    }
    console.log("[PRONOTE] Number of CAS available:", pronote.casList.length)
    log("CAS List:", pronote.casList)
    if (this.config.defaultAccount > 0) this.getAccount()
    else this.sendSocketNotification('ERROR', "Account: ne peut pas être égal à 0 !")
  },

  /** new configuration type **/
  getAccount: async function() {
    if (this.config.defaultAccount > this.config.Accounts.length) return this.sendSocketNotification('ERROR', "Numéro de compte inconnu ! (" + this.config.defaultAccount + ")")
    this.account = this.config.Accounts[this.accountNumber-1]
    if (!this.account.username) return this.sendSocketNotification('ERROR', "Compte " + this.accountNumber + ": Le champ user doit être remplis !")
    if (!this.account.password) return this.sendSocketNotification('ERROR', "Compte " + this.accountNumber + ": Le champ password doit être remplis !")
    if (!this.account.url) return this.sendSocketNotification('ERROR', "Compte " + this.accountNumber + ": Le champ url doit être remplis !")
    if (this.account.account !== "student" && this.account.account !== "parent" ) return this.sendSocketNotification('ERROR', "Compte " + this.accountNumber + ": Le champ account est incorrect (student ou parent)")
    if (this.account.account === "parent" && (!this.account.studentNumber || isNaN(this.account.studentNumber))) return this.sendSocketNotification('ERROR', "Compte " + this.accountNumber + ": studentNumber ne peux pas être égale 0 !")
    if (!this.account.cas) this.account.cas = "none"
    await this.pronote()
    /** fetch all account on start (loop) **/
    if (!this.init) {
      if (this.accountNumber == this.config.defaultAccount) {
        this.sendSocketNotification("INITIALIZED")
        this.currentDisplay = this.accountNumber
        if (this.config.rotateAccount && this.config.Accounts.length > 1 ) this.scheduleDisplay()
        else this.sendUpdated(this.cache[this.currentDisplay])
      }
      if (this.accountNumber+1 > this.config.Accounts.length) {
        console.log("[PRONOTE] Pronote is initialized.")
        this.accountNumber = this.config.defaultAccount
        this.init=true
        /** Ok ! All info is in cache now auto-update it ! **/
        this.scheduleUpdate()
      } else {
        this.accountNumber += 1
        log("Make Cache: set account to", this.accountNumber)
        this.getAccount()
      }
    }
  },

  getUpdate: async function(first) {
    if (!first) this.accountNumber = 1
    this.account = this.config.Accounts[this.accountNumber-1]
    await this.pronote()
    if (!this.config.rotateAccount && this.config.defaultAccount == this.accountNumber) this.sendUpdated(this.cache[this.config.defaultAccount])
    if (this.accountNumber+1 > this.config.Accounts.length) {
      log("Fetch Datas Done.")
      this.accountNumber = this.config.defaultAccount
    } else {
      this.accountNumber += 1
      log("Make Cache: set account to", this.accountNumber)
      this.getUpdate(true)
    }
  },

  pronote: async function() {
    this.session[this.accountNumber] = null
    this.session[this.accountNumber] = await this.login()
    if (this.session[this.accountNumber]) {
      this.session[this.accountNumber].setKeepAlive(true)
      await this.fetchData()
    }
  },

  /** Login to Pronote **/
  login: async function() {
    try {
      log("Pronote Login with account", this.accountNumber)
      if (this.account.account == "student") {
        return await pronote.login(
          this.account.url,
          this.account.username,
          this.account.password,
          this.account.cas
        )
      }
      else if(this.account.account == "parent") {
        return await pronote.loginParent(
          this.account.url,
          this.account.username,
          this.account.password,
          this.account.cas
        )
      }
      else this.sendSocketNotification('ERROR', "Prevent login error !!!")
    } catch (err) {
      if (err.code === pronote.errors.WRONG_CREDENTIALS.code) {
        console.error("[PRONOTE] Error Account " + this.accountNumber + " - code: " + err.code + " - message: " + err.message)
        this.sendSocketNotification('ERROR', "Mauvais identifiants Account " + this.accountNumber)
      } else {
        if (err.code) {
          console.error("[PRONOTE] Error code: " + err.code + " - message: " + err.message)
          this.sendSocketNotification('ERROR', err.message)
        }
        else {
          /** erreur du code merdique de Pronote-api ? **/
          console.error("[PRONOTE] API Error", err)
          this.sendSocketNotification('ERROR', "MMM-Pronote crash !")
          //setTimeout(async () => { await this.pronote() } , 3000) // !! not sure really needed !!
        }
      }
    }
  },

  fetchData: async function() {
    var data= {}
    /** create or update data object **/
    log("Pronote fetch data")
    if (!this.session[this.accountNumber]) return console.log("[PRONOTE] Error... No session !")

    /** check student **/
    if (this.account.account === "parent") {
      this.student = this.account.studentNumber-1
      if(this.student > this.session[this.accountNumber].user.students.length -1) {
        log("Taratata... Tu as que " + this.session[this.accountNumber].user.students.length + " enfant(s)...")
        this.student = 0
      }
    }

    /** fetch ONLY needed part from config **/

    if (this.config.Header.displayStudentName) {
      data["name"] = this.account.account == "student" ? this.session[this.accountNumber].user.name : this.session[this.accountNumber].user.students[this.student].name
      if (this.config.Header.displayStudentClass) {
        data["class"] = this.account.account == "student" ? this.session[this.accountNumber].user.studentClass.name : this.session[this.accountNumber].user.students[this.student].studentClass.name
      }
      if (this.config.Header.displayAvatar) {
        data["avatar"] = this.account.account == "student" ? this.session[this.accountNumber].user.avatar : this.session[this.accountNumber].user.students[this.student].avatar
      }
    }

    if (this.config.Header.displayEstablishmentName) {
      data["establishment"] = this.account.account == "student" ? this.session[this.accountNumber].user.establishment.name : this.session[this.accountNumber].user.students[this.student].establishment.name
    }

    var fromNow = new Date()
    var from = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate(),fromNow.getHours(),0,0) // garde l'heure de cours actuelle

    /** Check if Holidays times **/
    var isHolidays = this.session[this.accountNumber].params.publicHolidays.filter(Holidays => fromNow >= (new Date(Holidays.from.getFullYear(),Holidays.from.getMonth(),Holidays.from.getDate()-3,0,0,0))
      && fromNow < (new Date(Holidays.to.getFullYear(),Holidays.to.getMonth(),Holidays.to.getDate()+1,0,0,0)))
    data.isHolidays = {
      active: false,
      from: null,
      to: null,
      name: null,
      unique: false,
      tomorrow: false
    }
    var fromIsHolidays = isHolidays[0] ? isHolidays[0].from : null
    var toIsHolidays = isHolidays[0] ? isHolidays[0].to : null
    var nameIsHolidays = isHolidays[0] ? isHolidays[0].name : null
    if (isHolidays.length > 0) {
      if (fromIsHolidays.getTime() !== toIsHolidays.getTime()) {
        fromIsHolidays = new Date(fromIsHolidays.getFullYear(),fromIsHolidays.getMonth(),fromIsHolidays.getDate()-2,18,0,0)
        toIsHolidays = new Date(toIsHolidays.getFullYear(),toIsHolidays.getMonth(),toIsHolidays.getDate()-2,18,0,0)
      } else {
        toIsHolidays = new Date(toIsHolidays.getFullYear(),toIsHolidays.getMonth(),toIsHolidays.getDate(),23,59,0)
      }
      var startPublic = new Date(fromIsHolidays.getFullYear(),fromIsHolidays.getMonth(),fromIsHolidays.getDate(),0,0,0).getTime()
      var stopPublic =  new Date(toIsHolidays.getFullYear(),toIsHolidays.getMonth(),toIsHolidays.getDate(),0,0,0).getTime()
      var TomorrowFromNow = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate()+1,0,0,0).getTime()
      data.isHolidays.unique =  startPublic == stopPublic ? true: false
      data.isHolidays.tomorrow = startPublic == TomorrowFromNow ? true: false
      data.isHolidays.active = (!data.isHolidays.unique && (fromNow > fromIsHolidays) && (fromNow < toIsHolidays))? true : false
      data.isHolidays.from = fromIsHolidays
      data.isHolidays.to = toIsHolidays
      data.isHolidays.name = nameIsHolidays
    }

    if (this.config.debug && fromIsHolidays && toIsHolidays ) {
      data.isHolidays.formatFrom = this.formatDate(fromIsHolidays, true, { weekday: "long", day: 'numeric', month: "long", year: "numeric", hour: '2-digit', minute:'2-digit'})
      data.isHolidays.formatTo = this.formatDate(toIsHolidays, true, { weekday: "long", day: 'numeric', month: "long", year: "numeric", hour: '2-digit', minute:'2-digit'})
    }

    /** Display Holidays **/
    if (this.config.Holidays.display) {
      data["holidays"] = this.session[this.accountNumber].params.publicHolidays
      data.holidays = data.holidays.filter(Holidays => fromNow < Holidays.to)

      Array.from(data.holidays, (holiday) => {
        holiday.formattedFrom = this.formatDate(holiday.from)
        holiday.formattedTo = this.formatDate(holiday.to)
      })
    }

    if (this.config.Timetables.displayActual) { //fetch table Of the day of school
      const to = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate(),18,0,0) // fin des cours a 18h
      if (this.account.account === "student") {
        const timetableOfTheDay = await this.session[this.accountNumber].timetable(from,to)
        data["timetableOfTheDay"] = timetableOfTheDay
      } else {
        const timetableOfTheDay = await this.session[this.accountNumber].timetable(this.session[this.accountNumber].user.students[this.student], from,to)
        data["timetableOfTheDay"] = timetableOfTheDay
      }

      /** convert Dates en HH:MM **/
      this.localizedDate(data.timetableOfTheDay, {hour: '2-digit', minute:'2-digit'})
      /** don't display if it's not today **/
      if (data.timetableOfTheDay.length > 0) {
        let wanted = this.formatDate(data.timetableOfTheDay[0].to, true, { day: 'numeric' })
        let now = this.formatDate(new Date(), true, { day: 'numeric' })
        if (wanted != now) data["timetableOfTheDay"] = []
      }
    }

    if (this.config.Timetables.displayNextDay) { //fetch table Of Next day of school
      /** calculate next day of school **/
      let next = 1
      let day = fromNow.getDay()
      if (day == 5) next = 3
      if (day == 6) next = 2
      if (data.isHolidays.tomorrow && data.isHolidays.unique) next = next +1
      let FromNextDay = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate()+next,0,0,0)
      let ToNextDay =  new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate()+next,18,0,0)
      const NextDay = this.formatDate(FromNextDay, true, { weekday: "long", day: 'numeric', month: "long", year: "numeric" })
      var timetableOfNextDay = null
      if (this.account.account == "student") timetableOfNextDay = await this.session[this.accountNumber].timetable(FromNextDay,ToNextDay)
      else timetableOfNextDay = await this.session[this.accountNumber].timetable(this.session[this.accountNumber].user.students[this.student], FromNextDay,ToNextDay)

      data["timetableOfNextDay"] = { timetable: timetableOfNextDay, timetableDay: NextDay }
      this.localizedDate(data.timetableOfNextDay.timetable, {hour: '2-digit', minute:'2-digit'})
    }

    if (this.config.Averages.display || this.config.Marks.display) { // notes de l'eleve
      let toMarksSearch = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate() - this.config.Marks.searchDays,0,0,0)
      if (data.isHolidays.active) { // holidays -> lock start from the first day of holiday
        toMarksSearch = new Date(fromIsHolidays.getFullYear(),fromIsHolidays.getMonth(),fromIsHolidays.getDate() - this.config.Marks.searchDays,0,0,0)
      }
      var marks = null
      if (this.account.account == "student") data["marks"] = await this.session[this.accountNumber].marks(from, toMarksSearch)
      else data["marks"] = await this.session[this.accountNumber].marks(this.session[this.accountNumber].user.students[this.student], null, this.config.PeriodType)

      data.marks.subjects.filter(subject => {
        subject.marks = subject.marks.filter(mark => (mark.formattedDate = this.formatDate(mark.date, true)) && mark.date >= toMarksSearch)
      })

      data.marks.subjects = data.marks.subjects.filter(subject => subject.marks.length > 0)
    }

    if (this.config.Homeworks.display) { // liste des devoirs à faire
      var fromThis = fromNow
      if (data.isHolidays.active) fromThis = toIsHolidays // it's Holidays, so start since last day of it !

      let toHomeworksSearch = new Date(fromThis.getFullYear(),fromThis.getMonth(),fromThis.getDate() + this.config.Homeworks.searchDays,0,0,0)
      if (this.account.account === "student") data["homeworks"] = await this.session[this.accountNumber].homeworks(from,toHomeworksSearch)
      else data["homeworks"] = await this.session[this.accountNumber].homeworks(this.session[this.accountNumber].user.students[this.student], from,toHomeworksSearch)

      Array.from(data["homeworks"], (homework) => {
        homework.formattedFor = this.formatDate(homework.for, true, {weekday: "long", year: "numeric", month: "long", day: "numeric"})
      })

      /** display only number of day needed **/
      var fromStartTable= data.homeworks.length ? data.homeworks[0].for : fromNow
      var toHomeworksDisplayDay = new Date(fromStartTable.getFullYear(),fromStartTable.getMonth(),fromStartTable.getDate() + this.config.Homeworks.numberDays,0,0,0)
      data.homeworks = data.homeworks.filter(homework => homework.for < toHomeworksDisplayDay)
    }

    if (this.config.Absences.display || this.config.Delays.display) {
      let toAbsencesSearch = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate() - this.config.Absences.searchDays,0,0,0)
      if (data.isHolidays.active) {
        toAbsencesSearch = new Date(fromIsHolidays.getFullYear(),fromIsHolidays.getMonth(),fromIsHolidays.getDate() - this.config.Absences.searchDays,0,0,0)
      }
      //use my new feature (search by trimester // semester)
      var absencesValue = null
      if (this.account.account === "student") absencesValue = await this.session[this.accountNumber].absences(null , null, null, this.config.PeriodType)
      else absencesValue = await this.session[this.accountNumber].absences(this.session[this.accountNumber].user.students[this.student], null , null, null, this.config.PeriodType)

      data["absences"] = absencesValue["absences"]
      this.localizedDate(data["absences"], {month: "numeric", day: "numeric", hour: '2-digit', minute:'2-digit'})
      Array.from(data.absences, absence => {
        absence.oneDay= false
        let dateFrom = new Date(absence.from.getFullYear(),absence.from.getMonth(),absence.from.getDate(),0,0,0)
        let dateTo = new Date(absence.to.getFullYear(),absence.to.getMonth(),absence.to.getDate(),0,0,0)
        if (dateFrom.getTime() == dateTo.getTime()) {
          absence.oneDay = true
          absence.day = this.formatDate(absence.from, true, { day: 'numeric', month: 'short'})
          absence.fromHour = this.formatTime(absence.from, true)
          absence.toHour = this.formatTime(absence.to, true)
        }
      })
      data.absences = data.absences.filter(absences => absences.from > toAbsencesSearch).reverse()

      data["delays"] = absencesValue["delays"]
      let toDelaySearch = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate() - this.config.Delays.searchDays,0,0,0)
      if (data.isHolidays.active) {
        toDelaySearch = new Date(fromIsHolidays.getFullYear(),fromIsHolidays.getMonth(),fromIsHolidays.getDate() - this.config.Delays.searchDays,0,0,0)
      }
      Array.from(data["delays"], (course) => {
        course.localizedDate = this.formatTime(course.date, true, {month: "short", day: "numeric", hour: '2-digit', minute:'2-digit'})
      })
      data.delays = data.delays.filter(delays => delays.date > toDelaySearch).reverse()
    }

    await this.makeCache(data)
  },

  localizedDate: function(array, options= {}) {
    Array.from(array, (course) => {
        course.localizedFrom = this.formatTime(course.from, true, options)
        course.localizedTo = this.formatTime(course.to, true, options)
    })
  },

  formatDate: function(date, min = false, options = { day: 'numeric', month: 'numeric'} ) {
    if (!date) return ''
    if (!min) options = {}
    return (new Date(date)).toLocaleDateString(this.config.language, options)
  },

  formatTime: function(date, min = false, options = {hour: '2-digit', minute:'2-digit'} ) {
    if (!date) return ''
    if (!min) options = {}
    return (new Date(date)).toLocaleTimeString(this.config.language, options)
  },

  socketNotificationReceived: function(notification, payload) {
    switch(notification) {
      case 'SET_CONFIG':
        this.initialize(payload)
        break
      case 'SET_ACCOUNT':
        payload = parseInt(payload)
        if (this.config.Accounts.length > 1 && payload <= this.cache.length-1) {
          this.switchAccount(payload)
        }
        break
    }
  },

  /** update process **/
  scheduleUpdate: function(delay) {
    clearInterval(this.intervalUpdate)
    this.intervalUpdate = setInterval(async () => {
      if (this.config.Accounts.length > 1) await this.getUpdate()
      else {
        await this.pronote()
        log("Pronote data updated.")
        this.sendUpdated(this.cache[this.currentDisplay])
      }
    }, this.updateIntervalMilliseconds)
  },

  /** rotate display **/
  scheduleDisplay: function() {
    clearInterval(this.intervalDisplay)
    this.sendUpdated(this.cache[this.currentDisplay])
    this.intervalDisplay= setInterval(() => {
      if (this.config.rotateAccount) this.currentDisplay += 1
      if (this.currentDisplay > this.cache.length-1) this.currentDisplay = 1
      this.scheduleDisplay()
    }, this.displayIntervalMilliseconds)
  },

  /** cree un cache de donnée **/
  makeCache: async function(data) {
    return new Promise ((resolve) => {
      this.cache[this.accountNumber] = data
      if (this.cache[this.accountNumber].avatar) {
        var src = this.cache[this.accountNumber].avatar
        var out = __dirname + "/cache/" + this.cache[this.accountNumber].name + ".jpg"
        var displayOut = "modules/MMM-Pronote/cache/" + this.cache[this.accountNumber].name + ".jpg"
        fs.stat(out, async (err) => {
          if (!err) {
            this.setAvatar(this.accountNumber, displayOut)
            log("Cache Done")
            this.sessionLogout(this.accountNumber)
            resolve()
          }
          else if (err.code === 'ENOENT') {
            let download =  wget.download(src,out)
            log("Download Avatar...")
            download.on('end', () => {
              log("Download Done...")
              this.setAvatar(this.accountNumber, displayOut)
              log("Cache Done")
              this.sessionLogout(this.accountNumber)
              resolve()
            })
          }
        })
      } else {
        log("Cache Done")
        this.sessionLogout(this.accountNumber)
        resolve()
      }
    })
  },

  /** applique l'avatar telecharger depuis le cache **/
  setAvatar: async function (account,path) {
    this.cache[account].avatar = path
    log("Avatar Account " + account + " set to:", path)
  },

  sessionLogout: async function(session) {
    this.session[session].logout()
    log("Pronote Logout of account", session)
  },
  /** envoi les données du cache **/
  sendUpdated: function(data) {
    log("Display cache:", this.currentDisplay)
    this.sendSocketNotification("PRONOTE_UPDATED", data)
  },

  /** swith account...**/
  switchAccount: async function (accountNumber) {
    log("Switch Account:", accountNumber)
    this.config.defaultAccount = accountNumber
    this.currentDisplay = accountNumber
    if (this.config.rotateAccount) this.scheduleDisplay()
    else this.sendUpdated(this.cache[this.currentDisplay])
  },

  /** ***** **/
  /** Tools **/
  /** ***** **/

  /** convert h m s to ms (good idea !) **/
  getUpdateIntervalMillisecondFromString: function(intervalString) {
   let regexString = new RegExp("^\\d+[smhd]{1}$")
   let updateIntervalMillisecond = 0

   if (regexString.test(intervalString)){
     let regexInteger = "^\\d+"
     let integer = intervalString.match(regexInteger)
     let regexLetter = "[smhd]{1}$"
     let letter = intervalString.match(regexLetter)

     let millisecondsMultiplier = 1000
      switch (String(letter)) {
        case "s":
          millisecondsMultiplier = 1000
          break
        case "m":
          millisecondsMultiplier = 1000 * 60
          break
        case "h":
          millisecondsMultiplier = 1000 * 60 * 60
          break
        case "d":
          millisecondsMultiplier = 1000 * 60 * 60 * 24
          break
      }
      // convert the string into seconds
      updateIntervalMillisecond = millisecondsMultiplier * integer
    } else {
      updateIntervalMillisecond = 1000 * 60 * 60 * 24
    }
    return updateIntervalMillisecond
  },

  /** Add X day to the date **/
  addDays: function(date, days) {
    var result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
});
