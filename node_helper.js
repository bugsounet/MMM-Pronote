const pronote = require('@bugsounet/pronote-api');
const npmCheck = require("@bugsounet/npmcheck");
const NodeHelper = require("node_helper");

let log = (...args) => { /* do nothing */ }

module.exports = NodeHelper.create({
   start: function() {
    /** initialize all value there **/
    this.session = null
    this.interval = null
    this.timeLogout = null
    this.Checker = null
    this.data = {}
    this.student = 0
    this.account = {}
    this.init = false
  },

  initialize: function(config) {
    console.log("[PRONOTE] MMM-Pronote Version:", require('./package.json').version)
    this.config = config
    if (this.config.debug) log = (...args) => { console.log("[PRONOTE]", ...args) }
    this.updateIntervalMilliseconds = this.getUpdateIntervalMillisecondFromString(this.config.updateInterval)
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
    if (this.config.Account > 0) this.getAccount()
    else this.sendSocketNotification('ERROR', "Account: ne peut pas être égal à 0 !")
  },

  /** new configuration type **/
  getAccount: async function() {
    if (this.config.Account > this.config.Accounts.length) return this.sendSocketNotification('ERROR', "Numéro de compte inconnu ! (" + this.config.Account + ")")
    this.account = this.config.Accounts[this.config.Account-1]
    if (!this.account.username) return this.sendSocketNotification('ERROR', "Compte " + this.config.Account + ": Le champ user doit être remplis !")
    if (!this.account.password) return this.sendSocketNotification('ERROR', "Compte " + this.config.Account + ": Le champ password doit être remplis !")
    if (!this.account.url) return this.sendSocketNotification('ERROR', "Compte " + this.config.Account + ": Le champ url doit être remplis !")
    if (this.account.account !== "student" && this.account.account !== "parent" ) return this.sendSocketNotification('ERROR', "Compte " + this.config.Account + ": Le champ account est incorrect (student ou parent)")
    if (this.account.account === "parent" && (!this.account.studentNumber || isNaN(this.account.studentNumber))) return this.sendSocketNotification('ERROR', "Compte " + this.config.Account + ": studentNumber ne peux pas être égale 0 !")
    if (!this.account.cas) this.account.cas = "none"
    await this.pronote()
    if (!this.init) {
      this.sendSocketNotification("INITIALIZED")
      console.log("[PRONOTE] Pronote is initialized.")
      this.init = true
    }
  },

  pronote: async function() {
    this.session= null
    this.session = await this.login()
    this.session.setKeepAlive(true)
    await this.fetchData()
  },

  /** Login to Pronote **/
  login: async function() {
    try {
      log("Pronote Login.")
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
        console.error("[PRONOTE] Error code: " + err.code + " - message: " + err.message)
        this.sendSocketNotification('ERROR', "Mauvais identifiants")
      } else {
        if (err.code) {
          console.error("[PRONOTE] Error code: " + err.code + " - message: " + err.message)
          this.sendSocketNotification('ERROR', err.message)
        }
        else {
          /** erreur du code merdique de Pronote-api ? **/
          console.error("[PRONOTE] API Error", err)
          this.sendSocketNotification('ERROR', "MMM-Pronote crash !")
          setTimeout(async () => { await this.pronote() } , 3000)
        }
      }
    }
  },

  fetchData: async function() {
    /** create or update data object **/
    log("Pronote fetch data.")
    if (!this.session) return console.log("[PRONOTE] Error... No session !")

    /** check student **/
    if (this.account.account === "parent") {
      this.student = this.account.studentNumber-1
      if(this.student > this.session.user.students.length -1) {
        log("Taratata... Tu as que " + this.session.user.students.length + " enfant(s)...")
        this.student = 0
      }
    }

    /** fetch ONLY needed part from config **/

    if (this.config.Header.displayStudentName) {
      this.data["name"] = this.account.account == "student" ? this.session.user.name : this.session.user.students[this.student].name
      if (this.config.Header.displayStudentClass) {
        this.data["class"] = this.account.account == "student" ? this.session.user.studentClass.name : this.session.user.students[this.student].studentClass.name
      }
      if (this.config.Header.displayAvatar) {
        this.data["avatar"] = this.account.account == "student" ? this.session.user.avatar : this.session.user.students[this.student].avatar
      }
    }

    if (this.config.Header.displayEstablishmentName) {
      this.data["establishment"] = this.account.account == "student" ? this.session.user.establishment.name : this.session.user.students[this.student].establishment.name
    }

    var fromNow = new Date()
    var from = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate(),fromNow.getHours(),0,0) // garde l'heure de cours actuelle

    /** Check if Holidays times **/
    var isHolidays = this.session.params.publicHolidays.filter(Holidays => fromNow >= (new Date(Holidays.from.getFullYear(),Holidays.from.getMonth(),Holidays.from.getDate()-3,0,0,0))
      && fromNow < (new Date(Holidays.to.getFullYear(),Holidays.to.getMonth(),Holidays.to.getDate()+1,0,0,0)))
    this.data.isHolidays = {
      active: false,
      from: null,
      to: null,
      name: null
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
    }
    this.data.isHolidays.active = fromIsHolidays && (fromNow > fromIsHolidays) ? true : false
    this.data.isHolidays.from = fromIsHolidays
    this.data.isHolidays.to = toIsHolidays
    this.data.isHolidays.name = nameIsHolidays

    if (this.config.debug && fromIsHolidays && toIsHolidays ) {
      this.data.isHolidays.formatFrom = this.formatDate(fromIsHolidays, true, { weekday: "long", day: 'numeric', month: "long", year: "numeric", hour: '2-digit', minute:'2-digit'})
      this.data.isHolidays.formatTo = this.formatDate(toIsHolidays, true, { weekday: "long", day: 'numeric', month: "long", year: "numeric", hour: '2-digit', minute:'2-digit'})
    }

    /** Display Holidays **/
    if (this.config.Holidays.display) {
      this.data["holidays"] = this.session.params.publicHolidays
      this.data.holidays = this.data.holidays.filter(Holidays => fromNow < Holidays.to)

      Array.from(this.data.holidays, (holiday) => {
        holiday.formattedFrom = this.formatDate(holiday.from)
        holiday.formattedTo = this.formatDate(holiday.to)
      })
    }

    if (this.config.Timetables.displayActual) { //fetch table Of the day of school
      const to = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate(),18,0,0) // fin des cours a 18h
      if (this.account.account === "student") {
        const timetableOfTheDay = await this.session.timetable(from,to)
        this.data["timetableOfTheDay"] = timetableOfTheDay
      } else {
        const timetableOfTheDay = await this.session.timetable(this.session.user.students[this.student], from,to)
        this.data["timetableOfTheDay"] = timetableOfTheDay
      }

      /** convert Dates en HH:MM **/
      this.localizedDate(this.data.timetableOfTheDay, {hour: '2-digit', minute:'2-digit'})
      /** don't display if it's not today **/
      if (this.data.timetableOfTheDay.length > 0) {
        let wanted = this.formatDate(this.data.timetableOfTheDay[0].to, true, { day: 'numeric' })
        let now = this.formatDate(new Date(), true, { day: 'numeric' })
        if (wanted != now) this.data["timetableOfTheDay"] = []
      }
    }

    if (this.config.Timetables.displayNextDay) { //fetch table Of Next day of school
      /** calculate next day of school **/
      let next = 1
      let day = fromNow.getDay()
      if (day == 5) next = 3
      if (day == 6) next = 2
      let FromNextDay = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate()+next,0,0,0)
      let ToNextDay =  new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate()+next,18,0,0)
      const NextDay = this.formatDate(FromNextDay, true, { weekday: "long", day: 'numeric', month: "long", year: "numeric" })
      var timetableOfNextDay = null
      if (this.account.account == "student") timetableOfNextDay = await this.session.timetable(FromNextDay,ToNextDay)
      else timetableOfNextDay = await this.session.timetable(this.session.user.students[this.student], FromNextDay,ToNextDay)

      this.data["timetableOfNextDay"] = { timetable: timetableOfNextDay, timetableDay: NextDay }
      this.localizedDate(this.data.timetableOfNextDay.timetable, {hour: '2-digit', minute:'2-digit'})
    }

    if (this.config.Averages.display || this.config.Marks.display) { // notes de l'eleve
      let toMarksSearch = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate() - this.config.Marks.searchDays,0,0,0)
      if (this.data.isHolidays.active) { // holidays -> lock start from the first day of holiday
        toMarksSearch = new Date(fromIsHolidays.getFullYear(),fromIsHolidays.getMonth(),fromIsHolidays.getDate() - this.config.Marks.searchDays,0,0,0)
      }
      var marks = null
      if (this.account.account == "student") this.data["marks"] = await this.session.marks(from, toMarksSearch)
      else this.data["marks"] = await this.session.marks(this.session.user.students[this.student], null, this.config.PeriodType)

      this.data.marks.subjects.filter(subject => {
        subject.marks = subject.marks.filter(mark => (mark.formattedDate = this.formatDate(mark.date, true)) && mark.date >= toMarksSearch)
      })

      this.data.marks.subjects = this.data.marks.subjects.filter(subject => subject.marks.length > 0)
    }

    if (this.config.Homeworks.display) { // liste des devoirs à faire
      var fromThis = fromNow
      if (this.data.isHolidays.active) fromThis = toIsHolidays // it's Holidays, so start since last day of it !

      let toHomeworksSearch = new Date(fromThis.getFullYear(),fromThis.getMonth(),fromThis.getDate() + this.config.Homeworks.searchDays,0,0,0)
      if (this.account.account === "student") this.data["homeworks"] = await this.session.homeworks(from,toHomeworksSearch)
      else this.data["homeworks"] = await this.session.homeworks(this.session.user.students[this.student], from,toHomeworksSearch)

      Array.from(this.data["homeworks"], (homework) => {
        homework.formattedFor = this.formatDate(homework.for, true, {weekday: "short", year: "numeric", month: "short", day: "numeric"})
      })

      /** display only number of day needed **/
      var fromStartTable= this.data.homeworks.length ? this.data.homeworks[0].for : fromNow
      var toHomeworksDisplayDay = new Date(fromStartTable.getFullYear(),fromStartTable.getMonth(),fromStartTable.getDate() + this.config.Homeworks.numberDays,0,0,0)
      this.data.homeworks = this.data.homeworks.filter(homework => homework.for < toHomeworksDisplayDay)
    }

    if (this.config.Absences.display || this.config.Delays.display) {
      let toAbsencesSearch = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate() - this.config.Absences.searchDays,0,0,0)
      if (this.data.isHolidays.active) {
        toAbsencesSearch = new Date(fromIsHolidays.getFullYear(),fromIsHolidays.getMonth(),fromIsHolidays.getDate() - this.config.Absences.searchDays,0,0,0)
      }
      //use my new feature (search by trimester // semester)
      var absencesValue = null
      if (this.account.account === "student") absencesValue = await this.session.absences(null , null, null, this.config.PeriodType)
      else absencesValue = await this.session.absences(this.session.user.students[this.student], null , null, null, this.config.PeriodType)

      this.data["absences"] = absencesValue["absences"]
      this.localizedDate(this.data["absences"], {month: "numeric", day: "numeric", hour: '2-digit', minute:'2-digit'})
      Array.from(this.data.absences, absence => {
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
      this.data.absences = this.data.absences.filter(absences => absences.from > toAbsencesSearch).reverse()

      this.data["delays"] = absencesValue["delays"]
      let toDelaySearch = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate() - this.config.Delays.searchDays,0,0,0)
      if (this.data.isHolidays.active) {
        toDelaySearch = new Date(fromIsHolidays.getFullYear(),fromIsHolidays.getMonth(),fromIsHolidays.getDate() - this.config.Delays.searchDays,0,0,0)
      }
      Array.from(this.data["delays"], (course) => {
        course.localizedDate = this.formatTime(course.date, true, {month: "short", day: "numeric", hour: '2-digit', minute:'2-digit'})
      })
      this.data.delays = this.data.delays.filter(delays => delays.date > toDelaySearch).reverse()
    }

    if (this.config.debug) {
      //this.data["USER"] = this.session.user
      //this.data["PARAMS"] = this.session.params
      // reserved for later ?

      //const infos = await this.session.infos()
      //const menu = await this.session.menu()
      //const contents = await this.session.contents()

      /*
      const evaluations = await this.session.evaluations(this.session.user.students[this.student], null, this.config.PeriodType)
      this.data["infos"] = infos // info Prof/Etablisement -> eleves ?
      this.data["menu"] = menu // le menu de la cantine
      this.data["evaluations"] = evaluations // les resulat des evals
      this.data["contents"] = contents // je sais pas trop pour le moment c'est vide ... (peut-etre les actus ?)
      */
      //log("Data:", absences, delays) // log as you want ;)
    }

    /** send all datas ... **/
    this.sendSocketNotification("PRONOTE_UPDATED", this.data)

    /** Ok ! All info are sended auto-update it ! **/
    this.scheduleUpdate()
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
        if (this.config.Account > 0) this.switchAccount(payload)
        break
    }
  },

  /** update process **/
  scheduleUpdate: function(delay) {
    this.timeLogout = setTimeout(() => {
      this.session.logout()
      log("Pronote Logout.")
    }, 3000)

    let nextLoad = this.updateIntervalMilliseconds
    if (typeof delay !== "undefined" && delay >= 0) {
      nextLoad = delay
    }
    clearInterval(this.interval)
    this.interval = setInterval(async () => {
      if (this.config.rotateAccount && this.config.Accounts.length > 1) {
        if (this.config.Account+1 > this.config.Accounts.length) this.config.Account = 1
        else this.config.Account += 1
        log("Pronote set account to", this.config.Account)
        this.getAccount()
      }
      else {
        await this.pronote()
        log("Pronote data updated.")
      }
    }, nextLoad)
  },

  /** swith account...**/
  switchAccount: async function (accountNumber) {
    log("Switch Account:", accountNumber)
    clearTimeout(this.timeLogout)
    clearInterval(this.interval)
    this.sendSocketNotification("ACCOUNT_CHANGE")
    this.config.Account = accountNumber
    this.init = false
    this.getAccount()
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
