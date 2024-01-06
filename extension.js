/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
 
//Forked and Modified extensively from Removable Drive Menu by fmuellner
//Extension Written by Hariharan D

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import {
    Extension,
    gettext as _
} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MountMenuItem = GObject.registerClass({
        GTypeName: 'Gjs_MountMenuItem',
        Properties: {
            'refresh': GObject.ParamSpec.int(
                'refresh',
                'Used to notify changes to the mount size property',
                'refresh',
                GObject.ParamFlags.READWRITE,
                0,
                100,
                0
            ),
        },
    },
    class MountMenuItem extends PopupMenu.PopupBaseMenuItem {
        _init(mount) {
            super._init({
                style_class: 'drive-menu-item'
            });

            this.box = new St.BoxLayout({
                style_class: 'system-status-icon-box',
                vertical: true,
                x_expand: true,
                y_expand: true
            });

            this.label = new St.Label({
                text: 'Fetching..',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER

            });
            
            this.sizelabel = new St.Label({
                text: 'Fetching...',
                style: 'font-size: 13px; color: #888;',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
            });

            this.box.add_child(this.label);
            this.box.add_child(this.sizelabel);
            this.add_child(this.box);
            this.mount = mount;

            let ejectIcon2 = new St.Icon({
                icon_name: 'view-refresh-symbolic',
                style_class: 'popup-menu-icon'
            });
            
            let ejectButton1 = new St.Button({
                child: ejectIcon2,
                style_class: 'button'
            });
            
            this.add_child(ejectButton1);
            this.hide();

            ejectButton1.connect('clicked', () => {
                this._syncVisibility();
            });

            mount.connectObject('changed',
                () => {
                this._syncVisibility();
                }, this);

            this._syncVisibility();
        }

        async queryMount(attributes, io_priority = null, cancellable = null) {
            try {
                const root = this.mount.get_root();
                return new Promise((resolve, reject) => {
                    root.query_filesystem_info_async(attributes, io_priority, cancellable, (b, res) => {
                        try {

                            const fileInfo = root.query_info_finish(res);
                            this.totalSize = fileInfo.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_SIZE);
                            this.totalSize1 = fileInfo.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_USED);
                            this.diskpercent = this._calcPercentage(this.totalSize, this.totalSize1);
                            this.id = this.mount.get_name();
                            this.label.set_text(this.id);
                            this.sizelabel.set_text('Used:' + this.diskpercent + '%');
                            resolve(!fileInfo.get_attribute_boolean(Gio.FILE_ATTRIBUTE_FILESYSTEM_REMOTE));
                        } catch (e) {
                            reject(Gio._LocalFilePrototype.isPrototypeOf(b));
                        }
                    });
                });
            } catch (e) {
                return Promise.reject(e);
            }
        }
        
        async _syncVisibility() {
            try {
                this.visible = await this.queryMount('filesystem::');
                const sipValue = this.diskpercent;
                this.refresh = sipValue;
            } catch (e) {
                this.visible = e;
            }
        }

        _calcPercentage(totalSize, totalSize1) {
            let setperc = (totalSize1 / totalSize) * 100;
            setperc = setperc.toFixed(1);
            setperc = Math.ceil(setperc);
            return setperc;
        }
        
        primaryTimer() {

            const priority = GLib.PRIORITY_DEFAULT;
            const refresh_time = 5; 
            this._syncVisibility();
            if (this._timeout) {
                GLib.source_remove(this._timeout);
            }
            this._timeout = GLib.timeout_add_seconds(priority, refresh_time, () => {
                this.primaryTimer();
                return true;
            });
        }

        stopPrimaryTimer() {
            if (this._timeout) {
                GLib.source_remove(this._timeout);
            }
            this._timeout = undefined;
        }
    }
);


const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init() {
            super._init(0.5, _('My Shiny Indicator'));
            
            let stor = new St.Icon({
                icon_name: 'drive-removable-media-usb',
                style_class: 'system-status-icon'
            });
            
            let box = new St.BoxLayout({
                style_class: 'system-status-icon-box'
            });
            
            box.add_child(stor);
            
            this.sizeDisplay = new St.Label({
                text: 'No mounts...',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
                
            });
            
            box.add_child(this.sizeDisplay);
            this.add_child(box);
            this.timerMap = new Map();
            this._monitor = Gio.VolumeMonitor.get();
            
            this._monitor.connectObject(
                'mount-added', (monitor, mount) => this._addMount(mount),
                'mount-removed', (monitor, mount) => {
                    this._removeMount(mount);
                    this._updateMenuVisibility();
                }, this);

            this._mounts = [];
            this._monitor.get_mounts().forEach(this._addMount.bind(this));
            this._updateMenuVisibility();

        }

        _updateMenuVisibility() {
            if (this._mounts.filter(i => i.visible).length > 0) {
                this.show();
            } else {
                this.hide();
            }
        }

        _addMount(mount) {
            let item = new MountMenuItem(mount);
            this._mounts.unshift(item);
            this.menu.addMenuItem(item, 0);
            item.primaryTimer();
            
            item.connect('notify::refresh', (object, _pspec) => {
                this._timerRemove(mount);
                this._setMountForTimer(item.id, item.refresh);

            });

            item.connect('notify::visible', () => {
                this._updateMenuVisibility();
                this._setMountForTimer(item.id, item.diskpercent);
            });
        }

        _setMountForTimer(id, diskpercent) {
            this.timerMap.set(id, diskpercent);
            this._outputsvalue();
        }
        
        _outputsvalue() {
            this.mountlen = this._mounts.filter(i => i.visible).length;
            if ((this.timerMap.size === this.mountlen) && (this.mountlen != 0)) {
            
                let map1 = new Map(
                    Array.from(this.timerMap.entries()).sort((a, b) => a[1] - b[1])
                );
                
                this.mountName = map1.keys().next().value; // Stores Mount Name
                this.mountSize = map1.get(this.mountName); //Stores its size in percentage
                this.sizeDisplay.set_text(this.mountName.toString());
                this.count = 0;
                this._secondaryTimer();
                map1 = null;//Makes map1 ready for garbage collection
            }
        }
        
        _secondaryTimer() {
            const priority = GLib.PRIORITY_DEFAULT;
            const refresh_time = 2; 
            
            if (this.mountName === this.sizeDisplay.get_text()) {
                this.sizeDisplay.set_text(this.mountSize.toString() + '%');
                this.count = this.count + 1;

            } else {
                this.sizeDisplay.set_text(this.mountName.toString());
                this.count = this.count + 1;
            }
            if (this._timeout) {
                GLib.source_remove(this._timeout);
            }
            this._timeout = GLib.timeout_add_seconds(priority, refresh_time, () => {
            this._secondaryTimer();

                if (this.count === 5) {
                    GLib.source_remove(this._timeout);
                    this._timeout = undefined;
                    return false; // Return false to stop the timer loop
                }
                return true;
            });
        }

        destroy() {
            if (this._timeout) {
                GLib.source_remove(this._timeout);
            }
            this._timeout = undefined;
            super.destroy();
        }

        _removeMount(mount) {
            for (let i = 0; i < this._mounts.length; i++) {
                let item = this._mounts[i];
                if (item.mount === mount) {
                    item.stopPrimaryTimer();
                    item.destroy();
                    this._mounts.splice(i, 1);
                    this._timerRemove(mount);
                    return;
                }
            }
        }
        
        _timerRemove(mount) {
            if (mount.get_name() === this.mountName.toString()) {
                this.timerMap.delete(this.mountName);
                this._outputsvalue();
            }
        }
        
    }
);

export default class MountMeterExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
