var React = require('react');
var LocalStorageMixin = require('react-localstorage');
var PureRenderMixin = require('react-addons-pure-render-mixin');
var TimerMixin = require('react-timer-mixin');
var TransitionGroup = require('react-addons-css-transition-group');

var _ = require('lodash');
var cx = require('classnames');

var Audio = require('./Audio.js');
var CapsLock = require('./CapsLock.react.js');
var ChefBox = require('./ChefBox.react.js');
var Firebase = require('./FirebaseConfig.js');
var RecipeSelect = require('./RecipeSelect.react.js');
var TextInput = require('./TextInput.react.js');
var Inst = require('./Instruction.react.js');
var Leaderboard = require('./Leaderboard.react.js');
var LoadingQuote = require('./LoadingQuote.react.js');
var ModeSelect = require('./ModeSelect.react.js');
var Recipes = require('./recipes/Recipes.js');
var Volume = require('./Volume.react.js');


var VERSION = 'version 1.1.3'
var VERSION_CHANGELOG = 'https://toomanychefs-game.tumblr.com/post/614597271932256256/'

var Game = React.createClass({
  mixins: [LocalStorageMixin, PureRenderMixin, TimerMixin],

  getLocalStorageKey: function() {
    return 'toomanychefs';
  },

  getStateFilterKeys: function() {
    return ['saveData'];
  },

  getInitialState: function() {
    return {
      gameState: 'title',  // title | help | menu | started | options | loading
      chefs: [],
      stillAlive: 0,
      completed: 0,
      meal: 0,
      content: this.renderTitle(),
      startTime: 0,
      singlePlayer: null,
      fadeTitle: false,
      gameOver: false,
      report: null,
      record: 0,
      newRecord: false,
      saveData: {},
    };
  },

  componentDidMount: function() {
    this.setTimeout(() => {
      if (this.state.saveData.volume !== undefined) {
        Audio.setVolume(this.state.saveData.volume / 100);
      }
      Audio.playBGM(); // play music
    }, 500); // HACK: wait half a second to read saved volume
  },

  setStateDelay: function(state, delay) {
    delay = delay || 500;

    var renderContent = _.noop;
    switch (state) {
      case 'title':
        renderContent = this.renderTitle;
        break;
      case 'help':
        Audio.playSE('help');
        renderContent = this.renderHelp;
        break;
      case 'menu':
        renderContent = this.renderRecipeMenu;
        break;
      case 'credits':
        Audio.playSE('staff');
        renderContent = this.renderCredits;
        break;
      case 'options':
        renderContent = this.renderOptions;
        break;
      case 'loading':
        this.setTimeout(() => Audio.playSE('loading'), delay);
        renderContent = this.renderLoading;
        break;
    }

    this.setState({
      gameState: '',
      content: null,
      report: null,
    });
    this.setTimeout(() => this.setState({
      gameState: state,
      content: renderContent(),
    }), delay);
  },

  onStartGame: function() {
    this.setStateDelay('loading', 500);
    var meal = Recipes[this.state.meal];
    var chefs = this.state.singlePlayer
      ? _.get(meal, 'soloRecipes', meal.recipes)
      : meal.recipes;

    // Send Google Analytics event
    gtag('event', 'play_game', { recipe: meal.name });

    // Wait a random amount of time before loading (7-9s)
    this.setTimeout(() => {
      this.setState({
        gameState: 'started',
        stillAlive: 0,
        completed: 0,
        gameOver: false,
        chefs: chefs.map(_.clone),
        report: null,
        record: 0,
        newRecord: false,
      });
    }, 500 + _.random(7000, 9000));
  },

  onChooseMode: function(singlePlayer) {
    if (this.state.singlePlayer !== singlePlayer) {
      this.setState({fadeTitle: true});
      this.setTimeout(() => this.setState({
        singlePlayer: singlePlayer,
        fadeTitle: false,
      }), 350);

      if (singlePlayer) {
        document.title = 'Not Enough Chefs';
      } else {
        document.title = 'Too Many Chefs';
      }
    }

    if (this.state.gameState === 'title') {
      this.setTimeout(() => {
        this.setStateDelay('menu');
      }, 1500);
    }
  },

  onReady: function(player) {
    var stillAlive = this.state.stillAlive + 1;
    var chefs = this.state.chefs;
    this.setState({
      chefs: chefs,
      stillAlive: stillAlive,
    });

    // Are all chefs ready to begin?
    if (stillAlive === this.state.chefs.length) {
      Audio.playSE(['ready', 'begin']);
      this.setState({startTime: new Date().getTime()});
      for (var i = 0; i < this.state.chefs.length; i++) {
        var chef = this.refs['chef' + i];
        chef.startGame();
      }
      return true;
    }
    return false;
  },

  onFailure: function(loser, canSave) {
    if (this.state.gameOver) {
      return;
    }

    var stillAlive = this.state.stillAlive - 1;
    var chefs = this.state.chefs;
    chefs[loser].dead = true;
    this.setState({
      stillAlive: stillAlive,
      chefs: chefs,
    });

    // Propagate failure to everyone
    for (var i = 0; i < this.state.chefs.length; i++) {
      if (i === loser) {
        continue;
      }

      var chef = this.refs['chef' + i];
      var chefName = chefs[loser].chefName;

      if (!canSave) {
        chef.gameOver(<p>{chefName} failed to complete their recipe!</p>);
      } else if (!chefs[i].dead) {
        chef.showRescuePopup(chefName,
          () => this.refs['chef' + loser].rescue(loser));
      }
    }

    if (!canSave) {
      // Send Google Analytics event
      Audio.stopAllSounds();
      gtag('event', 'lose_game', { recipe: Recipes[this.state.meal].name });
      Audio.playSE('failure');
      this.setState({gameOver: true});
    }
  },

  // When rescued, unset dead and increment stillAlive
  onRescued: function(loser) {
    var chefs = this.state.chefs;
    chefs[loser].dead = false;
    this.setState({
      chefs: chefs,
      stillAlive: this.state.stillAlive + 1,
    });
  },

  onComplete: function(winner, record) {
    var completed = this.state.completed + 1;
    var chefs = this.state.chefs;
    chefs[winner].completed = true;
    this.setState({
      chefs: chefs,
      completed: completed,
      record: record,
    });

    if (completed === this.state.chefs.length) {
      // Send Google Analytics event
      Audio.stopAllSounds();
      gtag('event', 'win_game', {
        recipe: Recipes[this.state.meal].name,
        record: record,
      });
      this.saveData();
      return <p>Type <Inst onComplete={this.onReport}>report</Inst> to view your results.</p>;
    }
    return null;
  },

  onReport: function() {
    this.setState({report: this.renderReport()});
  },

  /* Save to localStorage */
  saveData: function() {
    // NOTE: for legacy reasons, the record is saved as "bestTime"
    // but it holds either times or counts
    var meal = Recipes[this.state.meal];
    var mode = this.state.singlePlayer ? 'solo' : 'party';
    var saveData = this.state.saveData;
    var mealData = _.get(saveData, [mode, meal.key], {});
    mealData.completed = true;
    var newRecord = !_.has(mealData, 'bestTime') || (meal.record === 'count'
        ? this.state.record > mealData.bestTime
        : this.state.record < mealData.bestTime);
    if (newRecord) {
      mealData.bestTime = this.state.record;
    }

    _.set(saveData, [mode, meal.key], mealData);
    this.setState({
      newRecord: newRecord,
      saveData: saveData,
    });
  },

  /* Save to Firebase (global leaderboard) */
  updateLeaderboard: function(name) {
    var meal = Recipes[this.state.meal];
    if (meal.tutorial) {
      return;
    }

    var mode = this.state.singlePlayer ? 'solo' : 'party';
    var newRecord = this.state.saveData[mode][meal.key].bestTime;
    var ref = Firebase.database().ref('leaderboard/' + mode + '/' + meal.key);
    ref.push({name: name, bestTime: newRecord}).setPriority(newRecord);

    // Update the user's name for this meal in localStorage.
    var saveData = this.state.saveData;
    var mealData = _.get(saveData, [mode, meal.key], {});
    mealData.leaderboardName = name;
    _.set(saveData, [mode, meal.key], mealData);

    this.setState({
      report: this.renderReport(true),
      saveData: saveData,
    });
  },

  onRenderMode: function() {
    Audio.playSE('start');
    if (this.state.singlePlayer !== null) {
      this.setStateDelay('menu');
    } else {
      this.setState({content: null});
      this.setTimeout(() => this.setState({
        content: this.renderMode(),
      }), 500);
    }
  },

  onVolumeChange: function(vol) {
    var saveData = this.state.saveData;
    saveData.volume = vol;
    this.setState({saveData: saveData});
  },

  renderTitle: function() {
    return (
      <div key="title" className="padTop">
        <p>Type <Inst onComplete={this.onRenderMode}>start</Inst> to begin</p>
        <p>Type <Inst onComplete={_.partial(this.setStateDelay, 'help')}>help</Inst> for instructions</p>
        <p>Type <Inst onComplete={_.partial(this.setStateDelay, 'options')}>options</Inst> for restaurant settings</p>
        <p>Type <Inst onComplete={_.partial(this.setStateDelay, 'credits')}>credits</Inst> for culinary staff</p>
      </div>
    );
  },

  renderMode: function() {
    return (
      <ModeSelect key="mode"
                  onSolo={_.partial(this.onChooseMode, true)}
                  onParty={_.partial(this.onChooseMode, false)} />
    );
  },

  renderOptions: function() {
    return (
      <div key="options" className="padTop">
        <h4>Options</h4>
        <br/>
        {this.renderMode()}
        <br/>
        <p>Volume:</p>
        <Volume init={this.state.saveData.volume} onVolumeChange={this.onVolumeChange} />
        <br/>
        <p>Type <Inst onComplete={_.partial(this.setStateDelay, 'title')}>back</Inst> to return to title</p>
      </div>
    );
  },

  onRecipeProgress: function(val) {
    this.setState({meal: val});
  },

  renderRecipeMenu: function() {
    var meal = this.state.meal;
    return (
      <div key="recipe-menu">
        <RecipeSelect onProgress={this.onRecipeProgress}
                      onSelect={this.onStartGame}
                      saveData={this.state.saveData}
                      singlePlayer={this.state.singlePlayer}
                      startValue={meal}
                      />
        <Inst onComplete={_.partial(this.setStateDelay, 'title')}>back</Inst>
      </div>
    );
  },

  renderHelp: function() {
    var heartFull = <span className="fireRed glyphicon glyphicon-heart" />;
    var heartEmpty = <span className="lightRed glyphicon glyphicon-heart-empty" />;
    var timer = <span className="glyphicon glyphicon-hourglass" />;

    return (
      <div className="padTop">
        <h4>A Chef's Guide</h4>
        <p>Follow the instructions, step by step, to complete your recipe!</p>
        <br/>

        <p>You may need to <Inst reset onComplete={Audio.playGoodVoice}>type a command</Inst>,<br/> move a dial with the arrow keys, <br/> and more.</p>
        <br/>

        <p>Watch your health {heartFull}{heartFull}{heartEmpty}<br/> and complete each step before the {timer} timer runs out!</p>
        <br/>

        <p>And last but not least... be mindful of the other chefs in the kitchen!<br/> You're all in this together.</p>
        <br/>
        <br/>
        <p>Type <Inst onComplete={_.partial(this.setStateDelay, 'title')}>back</Inst> to return to title</p>
      </div>
    );
  },

  renderLoading: function() {
    return <LoadingQuote key="loading" />;
  },

  renderCredits: function() {
    return (
      <div key="credits" className="padTop">
        <br/>
        <h4>Credits</h4>
        <p>
          <b>Chef de cuisine</b>: <a href="http://www.naviwang.me" target="_blank">Navi Wang</a> (design, programming)<br/>
          <b>Sous-chef</b>: James Wu (design)<br/>
          <b>Culinary consultant</b>: Anshu Bansal<br/>
          <b>Café jazz</b>: <i>Fortaleza</i> by Topher Mohr and Alex Elena
        </p>
        <br/>
        <h4>Contact</h4>
        <p><b>Email</b>: <a href="mailto:chef@toomanychefs.party" target="_top">chef@toomanychefs.party</a></p>
        <p><a href="https://www.facebook.com/navignaw/" target="_blank"><b>Facebook</b></a></p>
        <p><a href="http://www.naviwang.me" target="_blank"><b>Website</b></a></p>
        <p><a href="http://www.naviwang.me/#subscribe" target="_blank"><b>Subscribe</b></a></p>
        <br/><br/>
        <p>Type <Inst onComplete={_.partial(this.setStateDelay, 'title')}>back</Inst> to return to title</p>
      </div>
    );
  },

  renderChefBoxes: function() {
    return (
      <div>
        {this.state.chefs.map((recipe, i) =>
          <ChefBox key={i} ref={'chef' + i} chefId={i}
                   chefName={recipe.chefName}
                   numChefs={this.state.chefs.length}
                   recipe={recipe}
                   onReady={_.partial(this.onReady, i)}
                   onFailure={_.partial(this.onFailure, i)}
                   onComplete={this.onComplete}
                   onRescued={this.onRescued}
                   onReport={this.onReport}
                   stillAlive={this.state.stillAlive}
                   startTime={this.state.startTime}
                   singlePlayer={this.state.singlePlayer}
          />)}
        <TransitionGroup transitionName="fade"
                         transitionEnterTimeout={250}
                         transitionLeaveTimeout={250}>
          {this.state.report}
        </TransitionGroup>
      </div>
    );
  },

  renderReport: function(withInstructions) {
    var meal = Recipes[this.state.meal];
    var mode = this.state.singlePlayer ? 'solo' : 'party';
    var mealData = _.get(this.state.saveData, [mode, meal.key]);
    var won = this.state.completed === this.state.chefs.length;
    var newRecord = this.state.newRecord;

    var completeText = won
      ? <b className="green">SUCCESS {newRecord && '- NEW RECORD'}</b>
      : <b className="fireRed">FAILURE</b>;
    var recordText = won && (meal.record === 'count'
      ? <p>Count: {this.state.record}</p>
      : <p>Cook Time: {Leaderboard.renderTime(this.state.record)}</p>);

    if (!withInstructions) {
      if (newRecord) {
        Audio.playSE('newrecord');
      } else if (won) {
        Audio.playSE('success');
      }
    }

    var instructions = (
      <div>
        <p>Type <Inst onComplete={this.onStartGame}>replay</Inst> to restart the meal.</p>
        <p>Type <Inst onComplete={_.partial(this.setStateDelay, 'menu')}>back</Inst> to return to the menu.</p>
        <div id="fb-share" className="center padTop">
          <div className="fb-share-button" data-href="https://www.toomanychefs.party" data-layout="button_count" data-mobile-iframe="false" />
        </div>
      </div>
    );

    var typeName = (
      <div>
        <p>Name your {this.state.singlePlayer ? 'chef' : 'restaurant'} (press Enter to submit):</p>
        <TextInput onComplete={this.updateLeaderboard}
                   maxLength={20}
                   allowEnter allowBackspace />
      </div>
    );

    // HACK: Re-render FB share button after report renders
    if (typeof(FB) !== 'undefined' && _.has(FB, 'XFBML.parse')) {
      this.setTimeout(() => FB.XFBML.parse(document.getElementById('fb-share')), 200);
    }

    return (
      <div className="report center">
        <h3><b>{meal.name} - Review</b></h3>
        <h4>{completeText}</h4>
        {recordText}
        {this.state.chefs.map((r, i) =>
          <div key={i} className={cx({green: r.completed, fireRed: !r.completed})}>{r.name}</div>)}
        <br/>
        {withInstructions || !newRecord || meal.tutorial ? instructions : typeName}
      </div>
    );
  },

  render: function() {
    if (this.state.gameState === 'started') {
      return this.renderChefBoxes();
    }
    var titleText = this.state.singlePlayer ? 'Not Enough' : 'Too Many';
    var spacing = this.state.singlePlayer && <span>&nbsp;&nbsp;&nbsp;&nbsp;</span>; // for centering the longer title
    var description = this.state.singlePlayer ? 'multitasking' : 'cooperative';
    var fadeClass = cx('fade-leave', {'fade-leave-active': this.state.fadeTitle});
    var fadeWithColor = cx('fade-leave', {
      'fade-leave-active': this.state.fadeTitle,
      'green': !this.state.singlePlayer,
      'darkBlue': this.state.singlePlayer,
    });

    return (
      <div className="center">
        <div className={cx('vcenter', {vtop: this.state.gameState !== 'title'})}>
          <img className="chefHat" src="images/chefhat.png" alt="" />
          <h1><span className={fadeClass}>{titleText}</span> Chefs{spacing}</h1>
          <h4>A text-based <span className={fadeWithColor}>{description}</span> cooking game</h4>
        </div>

        <TransitionGroup transitionName="fade"
                         transitionEnterTimeout={250}
                         transitionLeaveTimeout={250}>
          {this.state.content}
          <CapsLock key="capslock" />
        </TransitionGroup>

        <div className="visible-xs-block alert alert-danger" role="alert">
          Sorry! This restaurant is incompatible with mobile devices. Please come back on a desktop web browser.
        </div>

        {this.state.gameState === 'title' && (
          <div className="corner">
            <a href={VERSION_CHANGELOG} target="blank_">{VERSION}</a>
          </div>
        )}
      </div>
    );
  },
});

module.exports = Game;
