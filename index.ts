import {
	EventsSDK,
	LocalPlayer,
	Menu,
	npc_dota_hero_huskar,
	item_armlet,
	TrackingProjectile
} from "github.com/octarine-public/wrapper/index"

const enum AbuseState {
	Idle,
	HumanDelayOff,
	ArmletOff,
	HumanDelayOn,
	Cooldown
}

new (class HuskarArmletAbuse {

	private readonly entry = Menu.AddEntry("Huskar")
	private readonly tree = this.entry.AddNode("Armlet Abuse")
	private readonly state = this.tree.AddToggle("State", false)
	private readonly hpThreshold = this.tree.AddSlider("HP Threshold %", 60, 5, 95)
	private readonly safeHP = this.tree.AddSlider("Safe HP (min to turn off)", 200, 50, 600)
	private readonly minDamage = this.tree.AddSlider("Min Damage to Trigger", 60, 10, 500)
	private readonly reactivateDelay = this.tree.AddSlider("Reactivate Delay ms", 80, 30, 400)
	private readonly cooldownAfter = this.tree.AddSlider("Cooldown After ms", 1000, 200, 3000)
	private readonly humanizeTree = this.tree.AddNode("Humanize")
	private readonly humanizeState = this.humanizeTree.AddToggle("State", true)
	private readonly humanizeMin = this.humanizeTree.AddSlider("Min Delay ms", 5, 0, 50)
	private readonly humanizeMax = this.humanizeTree.AddSlider("Max Delay ms", 15, 5, 100)
	private readonly maxAbusesPerMin = this.humanizeTree.AddSlider("Max Abuses per Minute", 18, 5, 30)

	private abuseState = AbuseState.Idle
	private timer = 0
	private lastHP = -1
	private dotTicks = 0
	private incomingProjectiles = 0
	private abuseTimestamps: number[] = []

	private readonly dangerousModifiers = [
		"modifier_ice_blast",
		"modifier_vessel_damage",
		"modifier_necrophos_reapers_scythe"
	]

	constructor() {
		EventsSDK.on("Tick", this.Tick.bind(this))
		EventsSDK.on("TrackingProjectileCreated", this.OnProjectileCreated.bind(this))
		EventsSDK.on("TrackingProjectileDestroyed", this.OnProjectileDestroyed.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private Rand(min: number, max: number): number {
		return Math.random() * (max - min) + min
	}

	private HumanDelay(): number {
		if (!this.humanizeState.value) {
			return 0
		}
		return this.Rand(this.humanizeMin.value, this.humanizeMax.value) / 1000
	}

	private IsAbuseLimitReached(): boolean {
		if (!this.humanizeState.value) {
			return false
		}
		const now = Date.now()
		this.abuseTimestamps = this.abuseTimestamps.filter(t => now - t < 60000)
		return this.abuseTimestamps.length >= this.maxAbusesPerMin.value
	}

	private RegisterAbuse(): void {
		this.abuseTimestamps.push(Date.now())
	}

	private GetHero(): npc_dota_hero_huskar | undefined {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !(hero instanceof npc_dota_hero_huskar)) {
			return undefined
		}
		return hero
	}

	private GetArmlet(hero: npc_dota_hero_huskar): item_armlet | undefined {
		return hero.Items.find((i): i is item_armlet => i instanceof item_armlet)
	}

	private CanAbuse(hero: npc_dota_hero_huskar): boolean {
		return (
			hero.IsAlive &&
			!hero.IsStunned &&
			!hero.IsHexed &&
			!hero.IsSilenced
		)
	}

	private HasDangerousDebuff(hero: npc_dota_hero_huskar): boolean {
		return hero.Buffs.some(b => this.dangerousModifiers.includes(b.Name))
	}

	private IsUnderDot(): boolean {
		return this.dotTicks >= 3
	}

	private BeginTurnOff(hero: npc_dota_hero_huskar, armlet: item_armlet): void {
		if (!armlet.IsToggled || !armlet.CanBeCasted()) {
			return
		}
		if (hero.HP < this.safeHP.value) {
			return
		}
		if (this.HasDangerousDebuff(hero)) {
			return
		}
		if (this.IsUnderDot()) {
			return
		}
		if (this.IsAbuseLimitReached()) {
			return
		}
		this.abuseState = AbuseState.HumanDelayOff
		this.timer = this.HumanDelay()
	}

	private TurnOff(hero: npc_dota_hero_huskar, armlet: item_armlet): void {
		if (!armlet.IsToggled || !armlet.CanBeCasted()) {
			return
		}
		hero.CastToggle(armlet)
		this.RegisterAbuse()
		this.abuseState = AbuseState.ArmletOff
	}

	private BeginTurnOn(): void {
		this.abuseState = AbuseState.HumanDelayOn
		this.timer = this.HumanDelay() + this.reactivateDelay.value / 1000
	}

	private TurnOn(hero: npc_dota_hero_huskar, armlet: item_armlet): void {
		if (armlet.IsToggled || !armlet.CanBeCasted()) {
			return
		}
		hero.CastToggle(armlet)
		this.abuseState = AbuseState.Cooldown
		this.timer = this.cooldownAfter.value / 1000
		this.dotTicks = 0
	}

	private Tick(dt: number): void {
		if (!this.state.value) {
			this.abuseState = AbuseState.Idle
			this.lastHP = -1
			this.dotTicks = 0
			return
		}

		const hero = this.GetHero()
		if (hero === undefined || !this.CanAbuse(hero)) {
			this.abuseState = AbuseState.Idle
			this.lastHP = -1
			this.dotTicks = 0
			return
		}

		const armlet = this.GetArmlet(hero)
		if (armlet === undefined) {
			return
		}

		if (this.abuseState === AbuseState.HumanDelayOff) {
			this.timer -= dt
			if (this.timer <= 0) {
				this.TurnOff(hero, armlet)
			}
			return
		}

		if (this.abuseState === AbuseState.ArmletOff) {
			if (this.incomingProjectiles === 0 && !this.HasDangerousDebuff(hero)) {
				this.BeginTurnOn()
			}
			return
		}

		if (this.abuseState === AbuseState.HumanDelayOn) {
			this.timer -= dt
			if (this.timer <= 0) {
				this.TurnOn(hero, armlet)
			}
			return
		}

		if (this.abuseState === AbuseState.Cooldown) {
			this.timer -= dt
			if (this.timer <= 0) {
				this.abuseState = AbuseState.Idle
				this.lastHP = hero.HP
			}
			return
		}

		const currentHP = hero.HP
		if (this.lastHP > 0) {
			const damage = this.lastHP - currentHP
			if (damage >= this.minDamage.value) {
				this.dotTicks = 0
				const hpPercent = (currentHP / hero.MaxHP) * 100
				if (hpPercent <= this.hpThreshold.value && this.incomingProjectiles === 0) {
					this.BeginTurnOff(hero, armlet)
				}
			} else if (damage > 5 && damage < this.minDamage.value) {
				this.dotTicks++
			} else {
				this.dotTicks = 0
			}
		}
		this.lastHP = currentHP
	}

	private OnProjectileCreated(projectile: TrackingProjectile): void {
		const hero = this.GetHero()
		if (hero === undefined || projectile.Target !== hero) {
			return
		}
		this.incomingProjectiles++

		if (!this.state.value || this.abuseState !== AbuseState.Idle) {
			return
		}
		if (!this.CanAbuse(hero)) {
			return
		}

		const armlet = this.GetArmlet(hero)
		if (armlet === undefined) {
			return
		}

		const hpPercent = (hero.HP / hero.MaxHP) * 100
		if (hpPercent > this.hpThreshold.value) {
			return
		}

		this.BeginTurnOff(hero, armlet)
	}

	private OnProjectileDestroyed(projectile: TrackingProjectile): void {
		const hero = this.GetHero()
		if (hero === undefined || projectile.Target !== hero) {
			return
		}
		if (this.incomingProjectiles > 0) {
			this.incomingProjectiles--
		}
	}

	private GameEnded(): void {
		this.abuseState = AbuseState.Idle
		this.timer = 0
		this.lastHP = -1
		this.dotTicks = 0
		this.incomingProjectiles = 0
		this.abuseTimestamps = []
	}

})()